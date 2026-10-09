package ai.chat2db.community.domain.core.impl.db;

import ai.chat2db.community.domain.api.config.DBConfig;
import ai.chat2db.community.domain.api.enums.parser.SqlTypeEnum;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import ai.chat2db.community.domain.api.model.metadata.Database;
import ai.chat2db.community.domain.api.model.request.datasource.DbDatabaseQueryAllRequest;
import ai.chat2db.community.domain.api.model.request.runtime.DbConnectionContextRequest;
import ai.chat2db.community.domain.api.model.request.sql.DbExecutionDatasourceRequest;
import ai.chat2db.community.domain.api.model.sql.ExecutionDatasource;
import ai.chat2db.community.domain.api.model.sql.SimpleSqlStatement;
import ai.chat2db.community.domain.api.model.sql.StatementExecutionTarget;
import ai.chat2db.community.domain.api.service.db.IDbConnectionContextService;
import ai.chat2db.community.domain.api.service.db.IDbDatabaseService;
import ai.chat2db.community.domain.api.service.db.IDbExecutionDatasourceService;
import ai.chat2db.community.domain.api.service.db.IDbSqlService;
import ai.chat2db.community.domain.core.cache.CacheKey;
import ai.chat2db.community.domain.core.cache.MemoryCacheManage;
import ai.chat2db.community.domain.api.model.metadata.Table;
import ai.chat2db.spi.IDbMetaData;
import ai.chat2db.spi.model.request.TablesRequest;
import ai.chat2db.spi.sql.Chat2DBContext;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * Moves a read-only statement to the datasource that holds the tables it names.
 * <p>
 * A console is bound to one datasource, but its completion reaches every datasource the tree offers,
 * so a statement it writes may name tables its own binding cannot serve. Those statements are looked
 * up in the bound target first and then across the requested scopes, in the order they were given,
 * and the first target holding every referenced table takes the statement.
 * <p>
 * Only queries are ever moved: a write belongs to the datasource the user chose. Anything the parser
 * cannot prove to be a single-dialect read - an unclassified statement, a dialect without a parser -
 * keeps the console's own binding, so this can never take a statement away from a target that would
 * have executed it.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class DbExecutionDatasourceServiceImpl implements IDbExecutionDatasourceService {

    /** Datasource/database pairs a single resolve may read before it stops looking. */
    static final int MAX_SCOPE_DATABASES = 24;

    /** Datasources a single resolve may visit. */
    static final int MAX_SCOPES = 12;

    /** Statements a single script may carry and still be routed statement by statement. */
    static final int MAX_ROUTED_STATEMENTS = 16;

    private final IDbSqlService dbSqlService;
    private final IDbConnectionContextService connectionContextService;
    private final IDbDatabaseService dbDatabaseService;

    @Override
    public ExecutionDatasource resolve(DbExecutionDatasourceRequest param) {
        if (param == null || StringUtils.isBlank(param.getSql()) || param.getDataSourceId() == null) {
            return ExecutionDatasource.none();
        }
        List<String> tableNames = referencedTableNames(param);
        if (tableNames.isEmpty()) {
            return ExecutionDatasource.none();
        }
        Target target = locate(param, withBoundScopeFirst(param), tableNames);
        if (!target.found() || isBoundTarget(param, target)) {
            return ExecutionDatasource.none();
        }
        return ExecutionDatasource.of(target.dataSourceId, target.dataSourceName, target.databaseName);
    }

    @Override
    public List<StatementExecutionTarget> resolveStatementTargets(DbExecutionDatasourceRequest param) {
        if (param == null || StringUtils.isBlank(param.getSql()) || param.getDataSourceId() == null) {
            return Collections.emptyList();
        }
        List<ParsedQuery> queries = routedQueryStatements(param);
        if (queries.isEmpty()) {
            return Collections.emptyList();
        }

        List<SqlCompletionScope> scopes = withBoundScopeFirst(param);
        List<StatementExecutionTarget> targets = new ArrayList<>(queries.size());
        for (ParsedQuery query : queries) {
            Target target = locate(param, scopes, query.tableNames());
            boolean relocated = target.found() && !isBoundTarget(param, target);
            targets.add(StatementExecutionTarget.builder()
                    .sql(query.statement().getSql())
                    .originalSql(query.statement().getSql())
                    .sequence(query.sequence())
                    .dataSourceId(relocated ? target.dataSourceId : null)
                    .dataSourceName(relocated ? target.dataSourceName : null)
                    .databaseName(relocated ? target.databaseName : null)
                    .schemaName(null)
                    .relocated(relocated)
                    .build());
        }
        return targets;
    }

    /**
     * Looks for the datasource/database pair that holds every referenced table, the console's own
     * binding first.
     *
     * @param param statement being resolved.
     * @param scopes datasources to look in, the bound one leading.
     * @param tableNames tables the statement needs, lower-cased.
     * @return the pair that took the tables, found only when one target holds all of them.
     */
    private Target locate(DbExecutionDatasourceRequest param,
                          List<SqlCompletionScope> scopes,
                          List<String> tableNames) {
        Target target = new Target();
        int remainingPairs = MAX_SCOPE_DATABASES;
        for (int index = 0; index < scopes.size(); index++) {
            if (remainingPairs <= 0 || target.found()) {
                break;
            }
            // Hold one pair back for every scope still to come, so a datasource with many databases
            // cannot spend the whole budget and hide the datasources behind it.
            int scopeBudget = Math.max(1, remainingPairs - (scopes.size() - index - 1));
            remainingPairs -= scopeBudget - lookUp(param, scopes.get(index), tableNames, target, scopeBudget);
        }
        return target;
    }

    /**
     * The statements of a script a routing may move, when the script is nothing but queries against
     * unqualified tables.
     *
     * @param param script to read.
     * @return one parsed query per statement, empty when the script must keep the console's binding.
     */
    private List<ParsedQuery> routedQueryStatements(DbExecutionDatasourceRequest param) {
        List<SimpleSqlStatement> statements;
        try {
            connectionContextService.bind(bindRequest(param.getDataSourceId(), param.getDatabaseName(),
                    param.getSchemaName()));
            // The parser reads the bound context, so an unbound resolve cannot even classify a statement.
            statements = dbSqlService.parseAndValidTableStatements(param.getSql(), dbType());
        } catch (Exception e) { // impl-contract: fallback - an unparsable script keeps the console's binding.
            log.debug("statement routing could not parse the script of console {}", param.getConsoleId(), e);
            return List.of();
        } finally {
            connectionContextService.clear();
        }
        if (statements == null || statements.isEmpty() || statements.size() > MAX_ROUTED_STATEMENTS) {
            return List.of();
        }

        List<ParsedQuery> queries = new ArrayList<>(statements.size());
        for (int index = 0; index < statements.size(); index++) {
            SimpleSqlStatement statement = statements.get(index);
            if (statement == null || !SqlTypeEnum.SELECT.name().equalsIgnoreCase(statement.getSqlType())) {
                // A write must never be moved, and an unclassified statement is not proven to be a query.
                return List.of();
            }
            Set<String> tableNames = new LinkedHashSet<>();
            for (SimpleSqlStatement.SimpleTable table : Objects.requireNonNullElse(statement.getTables(),
                    Collections.<SimpleSqlStatement.SimpleTable>emptyList())) {
                if (table == null || StringUtils.isBlank(table.getTableName())) {
                    continue;
                }
                if (StringUtils.isNotBlank(table.getDatabaseName()) || StringUtils.isNotBlank(table.getSchemaName())) {
                    // The statement already names the database to read; moving it would not help it.
                    return List.of();
                }
                tableNames.add(table.getTableName().toLowerCase(Locale.ROOT));
            }
            queries.add(new ParsedQuery(statement, index + 1, List.copyOf(tableNames)));
        }
        return queries;
    }

    /**
     * Table names a query references, when the script is nothing but queries against unqualified tables.
     *
     * @param param statement to read.
     * @return lower-cased table names, empty when the statement must keep the console's binding.
     */
    private List<String> referencedTableNames(DbExecutionDatasourceRequest param) {
        List<SimpleSqlStatement> statements;
        try {
            connectionContextService.bind(bindRequest(param.getDataSourceId(), param.getDatabaseName(),
                    param.getSchemaName()));
            // The parser reads the bound context, so an unbound resolve cannot even classify a statement.
            statements = dbSqlService.parseAndValidTableStatements(param.getSql(), dbType());
        } catch (Exception e) { // impl-contract: fallback - an unparsable statement keeps the console's binding.
            log.debug("execution target resolve could not parse the statement of console {}", param.getConsoleId(), e);
            return List.of();
        } finally {
            connectionContextService.clear();
        }
        if (statements == null || statements.isEmpty()) {
            return List.of();
        }

        List<String> tableNames = new ArrayList<>();
        for (SimpleSqlStatement statement : statements) {
            if (statement == null || !SqlTypeEnum.SELECT.name().equalsIgnoreCase(statement.getSqlType())) {
                // A write must never be moved, and an unclassified statement is not proven to be a query.
                return List.of();
            }
            if (statement.getTables() == null) {
                continue;
            }
            for (SimpleSqlStatement.SimpleTable table : statement.getTables()) {
                if (table == null || StringUtils.isBlank(table.getTableName())) {
                    continue;
                }
                if (StringUtils.isNotBlank(table.getDatabaseName()) || StringUtils.isNotBlank(table.getSchemaName())) {
                    // The statement already names the database to read; moving it would not help it.
                    return List.of();
                }
                tableNames.add(table.getTableName().toLowerCase(Locale.ROOT));
            }
        }
        return tableNames.stream().distinct().toList();
    }

    /**
     * Looks for a database of one scope that holds every referenced table.
     *
     * @param param statement being resolved.
     * @param scope datasource scope to look in.
     * @param tableNames tables the statement needs, lower-cased.
     * @param target accumulator shared by every scope.
     * @param budget datasource/database pairs this scope may read.
     * @return the budget left after this scope.
     */
    private int lookUp(DbExecutionDatasourceRequest param,
                       SqlCompletionScope scope,
                       List<String> tableNames,
                       Target target,
                       int budget) {
        Long dataSourceId = scope.dataSourceId();
        List<String> databases;
        String datasourceName;
        try {
            connectionContextService.bind(bindRequest(dataSourceId, scope.databaseName(), scope.schemaName()));
            datasourceName = datasourceName();
            databases = resolveDatabases(param, scope);
        } catch (Exception e) { // impl-contract: fallback - one unreachable datasource must not stop the search.
            log.debug("execution target resolve skipped datasource {}", dataSourceId, e);
            return budget;
        } finally {
            connectionContextService.clear();
        }

        for (String databaseName : databases) {
            if (budget <= 0 || target.found()) {
                break;
            }
            budget--;
            if (holds(dataSourceId, databaseName, tableNames)) {
                target.accept(dataSourceId, datasourceName, databaseName);
            }
        }
        return budget;
    }

    /**
     * Databases a scope covers: the one it names, otherwise every database the user may read.
     * <p>
     * The console's own datasource is widened around the database it has chosen: another database of
     * the connection already open is a far shorter move than another connection, so it is tried first.
     *
     * @param param statement being resolved.
     * @param scope datasource scope to resolve.
     * @return database names to look in; a single {@code null} entry when the datasource has no database concept.
     */
    private List<String> resolveDatabases(DbExecutionDatasourceRequest param, SqlCompletionScope scope) {
        if (StringUtils.isNotBlank(scope.databaseName())) {
            if (!Objects.equals(scope.dataSourceId(), param.getDataSourceId())) {
                return Collections.singletonList(scope.databaseName());
            }
            List<String> widened = new ArrayList<>();
            widened.add(scope.databaseName());
            for (String databaseName : allDatabaseNames(scope.dataSourceId())) {
                if (!StringUtils.equals(databaseName, scope.databaseName())) {
                    widened.add(databaseName);
                }
            }
            return widened;
        }
        DBConfig dbConfig = Chat2DBContext.getDBConfig();
        if (dbConfig == null || !dbConfig.isSupportDatabase()) {
            return Collections.singletonList(null);
        }
        return allDatabaseNames(scope.dataSourceId());
    }

    /**
     * Every database of a datasource the user may read, the ones the console is not allowed to see left out.
     */
    private List<String> allDatabaseNames(Long dataSourceId) {
        DbDatabaseQueryAllRequest request = new DbDatabaseQueryAllRequest();
        request.setDataSourceId(dataSourceId);
        request.setDbType(dbType());
        List<Database> databases = dbDatabaseService.queryAll(request);
        if (databases == null) {
            return Collections.emptyList();
        }
        List<String> names = new ArrayList<>(databases.size());
        for (Database database : databases) {
            if (database == null || database.isSystem() || StringUtils.isBlank(database.getName())) {
                continue;
            }
            names.add(database.getName());
        }
        return names;
    }

    /**
     * Whether one database holds every referenced table. Reads tables and views through the same cache
     * the SQL completion reads, so a resolve after a completion costs no metadata round trip.
     */
    private boolean holds(Long dataSourceId, String databaseName, List<String> tableNames) {
        try {
            connectionContextService.bind(bindRequest(dataSourceId, databaseName, null));
            return availableNames(dataSourceId, databaseName).containsAll(tableNames);
        } catch (Exception e) { // impl-contract: fallback - an unreadable database is not a target.
            log.debug("execution target resolve could not read datasource {} database {}", dataSourceId, databaseName, e);
            return false;
        } finally {
            connectionContextService.clear();
        }
    }

    private Set<String> availableNames(Long dataSourceId, String databaseName) {
        IDbMetaData metaData = Chat2DBContext.getDbMetaData();
        Set<String> names = new HashSet<>();
        List<Table> tables = MemoryCacheManage.computeIfAbsent(
                CacheKey.getTableKey(dataSourceId, databaseName, null),
                () -> new ArrayList<>(metaData.tables(Chat2DBContext.getConnection(),
                        new TablesRequest(databaseName, null, null))));
        List<Table> views = MemoryCacheManage.computeIfAbsent(
                CacheKey.getViewKey(dataSourceId, databaseName, null),
                () -> {
                    List<Table> read = metaData.views(Chat2DBContext.getConnection(), databaseName, null);
                    return read == null ? new ArrayList<Table>() : new ArrayList<>(read);
                });
        addNames(names, tables);
        addNames(names, views);
        return names;
    }

    private static void addNames(Set<String> names, List<Table> tables) {
        if (tables == null) {
            return;
        }
        for (Table table : tables) {
            if (table != null && StringUtils.isNotBlank(table.getName())) {
                names.add(table.getName().toLowerCase(Locale.ROOT));
            }
        }
    }

    /**
     * Whether the statement stays where it already was, in which case the caller keeps its own request.
     */
    private boolean isBoundTarget(DbExecutionDatasourceRequest param, Target target) {
        return Objects.equals(target.dataSourceId, param.getDataSourceId())
                && StringUtils.equals(target.databaseName, param.getDatabaseName());
    }

    /**
     * The scopes to look in, the console's own binding leading.
     * <p>
     * The bound target is prepended rather than trusted to be in the list: whatever the caller sent, the
     * console's own datasource is the one the statement belongs to until another one proves otherwise.
     */
    private List<SqlCompletionScope> withBoundScopeFirst(DbExecutionDatasourceRequest param) {
        List<SqlCompletionScope> scopes = new ArrayList<>();
        scopes.add(SqlCompletionScope.of(param.getDataSourceId(), param.getDatabaseName(), param.getSchemaName()));
        for (SqlCompletionScope scope : normalizeScopes(param.getScopes())) {
            if (Objects.equals(scope.dataSourceId(), param.getDataSourceId())) {
                continue;
            }
            if (scopes.size() >= MAX_SCOPES) {
                break;
            }
            scopes.add(scope);
        }
        return scopes;
    }

    private List<SqlCompletionScope> normalizeScopes(List<SqlCompletionScope> scopes) {
        if (scopes == null || scopes.isEmpty()) {
            return Collections.emptyList();
        }
        Map<Long, SqlCompletionScope> unique = new LinkedHashMap<>();
        for (SqlCompletionScope scope : scopes) {
            if (scope == null || scope.dataSourceId() == null || scope.dataSourceId() < 1L) {
                continue;
            }
            unique.putIfAbsent(scope.dataSourceId(), scope);
            if (unique.size() >= MAX_SCOPES) {
                break;
            }
        }
        return new ArrayList<>(unique.values());
    }

    private String dbType() {
        DBConfig dbConfig = Chat2DBContext.getDBConfig();
        return dbConfig == null ? null : dbConfig.getDbType();
    }

    private String datasourceName() {
        return Chat2DBContext.getConnectInfo() == null ? null : Chat2DBContext.getConnectInfo().getAlias();
    }

    private DbConnectionContextRequest bindRequest(Long dataSourceId, String databaseName, String schemaName) {
        DbConnectionContextRequest request = new DbConnectionContextRequest();
        request.setDataSourceId(dataSourceId);
        request.setDatabaseName(databaseName);
        request.setSchemaName(schemaName);
        return request;
    }

    /**
     * The datasource/database pair that took the statement, once one is found.
     */
    private static final class Target {

        private Long dataSourceId;
        private String dataSourceName;
        private String databaseName;

        boolean found() {
            return dataSourceId != null;
        }

        void accept(Long dataSourceId, String dataSourceName, String databaseName) {
            this.dataSourceId = dataSourceId;
            this.dataSourceName = dataSourceName;
            this.databaseName = databaseName;
        }
    }

    /**
     * One routable statement of a script: its text, its position and the tables it needs, lower-cased.
     */
    private record ParsedQuery(SimpleSqlStatement statement, int sequence, List<String> tableNames) {
    }
}
