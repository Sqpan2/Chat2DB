package ai.chat2db.community.domain.core.impl.db;

import ai.chat2db.community.domain.api.config.DBConfig;
import ai.chat2db.community.domain.api.enums.completion.SqlCompletionCandidateTypeEnum;
import ai.chat2db.community.domain.api.enums.completion.SqlCompletionStatusEnum;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionCandidate;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionEditorHint;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import ai.chat2db.community.domain.api.model.completion.result.SqlCompletionResponse;
import ai.chat2db.community.domain.api.model.metadata.Database;
import ai.chat2db.community.domain.api.model.request.runtime.DbConnectionContextRequest;
import ai.chat2db.community.domain.api.model.request.sql.DbSqlCompletionGetRequest;
import ai.chat2db.community.domain.api.model.request.sql.DbSqlUnboundCompletionRequest;
import ai.chat2db.community.domain.api.service.db.IDbConnectionContextService;
import ai.chat2db.community.domain.api.service.db.IDbSqlCompletionService;
import ai.chat2db.community.domain.api.service.db.IDbSqlUnboundCompletionService;
import ai.chat2db.spi.IDbMetaData;
import ai.chat2db.spi.sql.Chat2DBContext;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * Merges SQL completion candidates from several datasource scopes for an unbound editor.
 * <p>
 * The editor keeps working when nothing is selected: the scopes arrive ordered by relevance, and
 * every scope contributes its own completion result - the datasource's own database when the scope
 * names one, otherwise all of its databases. Candidates are deduplicated by type and label, keeping
 * the highest-priority occurrence, and tagged with a scope-ordered sort key so the most relevant
 * datasource still leads the suggestion list.
 * <p>
 * Metadata reads are the expensive part, so a single fan-out reads a bounded number of
 * datasource/database pairs, holding a pair back for every scope still to come so the trailing
 * datasources are never starved; the per-pair table cache makes later requests cheap.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class DbSqlUnboundCompletionServiceImpl implements IDbSqlUnboundCompletionService {

    /** Datasource/database pairs a single fan-out may read before it stops collecting. */
    static final int MAX_SCOPE_DATABASES = 24;

    /** Upper bound for the merged candidate list. */
    static final int MAX_MERGED_CANDIDATES = 1200;

    /** Candidates of one datasource/database pair the merge keeps before it thins that pair out. */
    static final int MAX_CANDIDATES_PER_PAIR = 200;

    /** Datasources a single fan-out may visit. */
    static final int MAX_SCOPES = 12;

    private static final String MERGE_KEY_SEPARATOR = " ";

    private final IDbSqlCompletionService sqlCompletionService;
    private final IDbConnectionContextService connectionContextService;

    @Override
    public SqlCompletionResponse complete(DbSqlUnboundCompletionRequest param) {
        if (param == null || StringUtils.isBlank(param.getSql())) {
            return SqlCompletionResponse.rejected("sql.completion.param.null");
        }
        List<SqlCompletionScope> scopes = normalizeScopes(param.getScopes());
        if (scopes.isEmpty()) {
            return SqlCompletionResponse.rejected("sql.completion.unbound.scope.empty");
        }

        Merge merge = new Merge();
        int remainingPairs = MAX_SCOPE_DATABASES;
        for (int index = 0; index < scopes.size(); index++) {
            if (remainingPairs <= 0 || merge.isFull()) {
                break;
            }
            // Hold one pair back for every scope still to come, so a datasource with many databases
            // cannot spend the whole budget and push the later datasources out of the fan-out.
            int scopeBudget = Math.max(1, remainingPairs - (scopes.size() - index - 1));
            int left = collectScope(param, scopes.get(index), merge, scopeBudget);
            remainingPairs -= scopeBudget - left;
        }
        return merge.toResponse();
    }

    /**
     * Collects the candidates of one datasource scope, spending at most {@code budget} of the
     * fan-out's datasource/database budget.
     *
     * @param param original unbound completion request.
     * @param scope datasource scope to collect from.
     * @param merge accumulator shared by every scope.
     * @param budget datasource/database pairs this scope may read.
     * @return the budget left after this scope.
     */
    private int collectScope(DbSqlUnboundCompletionRequest param,
                             SqlCompletionScope scope,
                             Merge merge,
                             int budget) {
        Long dataSourceId = scope.dataSourceId();
        List<String> databases;
        String datasourceName;
        try {
            connectionContextService.bind(bindRequest(dataSourceId, scope.databaseName(), scope.schemaName()));
            datasourceName = datasourceName();
            databases = resolveDatabases(scope);
        } catch (Exception e) { // impl-contract: fallback - one unreachable datasource must not fail the whole fan-out.
            log.debug("unbound completion skipped datasource {}", dataSourceId, e);
            return budget;
        } finally {
            connectionContextService.clear();
        }

        for (String databaseName : databases) {
            if (budget <= 0 || merge.isFull()) {
                break;
            }
            budget--;
            try {
                connectionContextService.bind(bindRequest(dataSourceId, databaseName, scope.schemaName()));
                merge.add(sqlCompletionService.complete(getRequest(param, dataSourceId, databaseName, scope.schemaName())),
                        datasourceName);
            } catch (Exception e) { // impl-contract: fallback - an unreadable database must not fail the whole fan-out.
                log.debug("unbound completion failed for datasource {} database {}", dataSourceId, databaseName, e);
            } finally {
                connectionContextService.clear();
            }
        }
        return budget;
    }

    /**
     * Resolves the databases a scope covers. A scope that names a database covers exactly that one;
     * otherwise every non-system database of the datasource is covered, and datasources without a
     * database concept fall back to a single scope-less read.
     *
     * @param scope datasource scope to resolve.
     * @return database names to complete against; a single {@code null} entry when the datasource has no database concept.
     */
    private List<String> resolveDatabases(SqlCompletionScope scope) {
        if (StringUtils.isNotBlank(scope.databaseName())) {
            return Collections.singletonList(scope.databaseName());
        }
        DBConfig dbConfig = Chat2DBContext.getDBConfig();
        IDbMetaData metaData = Chat2DBContext.getDbMetaData();
        if (dbConfig == null || metaData == null || !dbConfig.isSupportDatabase()) {
            return Collections.singletonList(null);
        }
        List<Database> databases = metaData.databases(Chat2DBContext.getConnection());
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

    private DbSqlCompletionGetRequest getRequest(DbSqlUnboundCompletionRequest param,
                                                 Long dataSourceId,
                                                 String databaseName,
                                                 String schemaName) {
        DbSqlCompletionGetRequest request = new DbSqlCompletionGetRequest();
        request.setConsoleId(param.getConsoleId());
        request.setDataSourceId(dataSourceId);
        request.setDatabaseName(databaseName);
        request.setSchemaName(schemaName);
        request.setSql(param.getSql());
        request.setCursor(param.getCursor() == null ? 0 : param.getCursor());
        request.setMinPrefixLength(param.getMinPrefixLength());
        request.setNeedFullName(param.getNeedFullName());
        request.setKeywordCase(param.getKeywordCase());
        request.setActiveSnippetSlot(param.getActiveSnippetSlot());
        return request;
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

    /**
     * Accumulates the candidates every scope contributes, in scope priority order.
     */
    static final class Merge {

        private final List<SqlCompletionCandidate> candidates = new ArrayList<>();
        private final Set<String> seenLabels = new HashSet<>();
        private final Set<String> usedIds = new HashSet<>();
        private List<SqlCompletionEditorHint> editorHints;
        private int scopeIndex;
        private int replaceStart = -1;
        private int replaceEnd = -1;

        boolean isFull() {
            return candidates.size() >= MAX_MERGED_CANDIDATES;
        }

        /**
         * Merges one scope's completion result, then advances to the next scope.
         *
         * @param response completion result of the (datasource, database) pair just read.
         * @param datasourceName alias of the datasource the result came from, used when a candidate carries none.
         */
        void add(SqlCompletionResponse response, String datasourceName) {
            if (response == null) {
                scopeIndex++;
                return;
            }
            // Hints describe the statement the cursor sits in, not a datasource, so the most relevant
            // scope that produces them owns them.
            if ((editorHints == null || editorHints.isEmpty())
                    && response.getEditorHints() != null && !response.getEditorHints().isEmpty()) {
                editorHints = new ArrayList<>(response.getEditorHints());
            }
            if (response.getCandidates() == null
                    || !SqlCompletionStatusEnum.SUCCESS.name().equals(response.getStatus())) {
                scopeIndex++;
                return;
            }
            if (replaceStart < 0) {
                replaceStart = response.getReplaceStart();
                replaceEnd = response.getReplaceEnd();
            }
            String sortPrefix = String.format(Locale.ROOT, "%03d", scopeIndex);
            // Columns are the scarce candidates a fan-out exists for: they survive the per-pair cap
            // untouched, while the keyword and table flood of one database cannot crowd the pairs
            // behind it out of the merged list.
            int pairBudget = MAX_CANDIDATES_PER_PAIR;
            for (SqlCompletionCandidate candidate : response.getCandidates()) {
                if (candidate == null || isFull()) {
                    continue;
                }
                boolean column = candidate.getType() == SqlCompletionCandidateTypeEnum.COLUMN;
                if (!column) {
                    if (pairBudget <= 0) {
                        continue;
                    }
                    pairBudget--;
                }
                String label = candidate.getLabel();
                if (StringUtils.isBlank(label)) {
                    continue;
                }
                String mergeKey = (candidate.getType() == null ? "" : candidate.getType().name())
                        + MERGE_KEY_SEPARATOR + label.toLowerCase(Locale.ROOT);
                if (!seenLabels.add(mergeKey)) {
                    continue;
                }
                if (StringUtils.isBlank(candidate.getDatasourceName())) {
                    candidate.setDatasourceName(datasourceName);
                }
                // Later scopes sort behind earlier ones while keeping their own ordering inside a scope.
                candidate.setSortText(sortPrefix + StringUtils.defaultString(candidate.getSortText()));
                if (candidate.getId() != null && !usedIds.add(candidate.getId())) {
                    candidate.setId(scopeIndex + ":" + candidate.getId());
                    usedIds.add(candidate.getId());
                }
                candidates.add(candidate);
            }
            scopeIndex++;
        }

        SqlCompletionResponse toResponse() {
            if (candidates.isEmpty() && (editorHints == null || editorHints.isEmpty())) {
                return SqlCompletionResponse.empty();
            }
            SqlCompletionResponse response =
                    SqlCompletionResponse.success(Math.max(0, replaceStart), Math.max(0, replaceEnd), candidates);
            if (editorHints != null && !editorHints.isEmpty()) {
                response.setEditorHints(editorHints);
            }
            return response;
        }
    }
}
