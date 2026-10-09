package ai.chat2db.community.domain.core.impl.db;

import ai.chat2db.community.domain.api.config.DBConfig;
import ai.chat2db.community.domain.api.config.DriverConfig;
import ai.chat2db.community.domain.api.enums.parser.SqlTypeEnum;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import ai.chat2db.community.domain.api.model.metadata.Database;
import ai.chat2db.community.domain.api.model.metadata.Table;
import ai.chat2db.community.domain.api.model.request.datasource.DbDatabaseQueryAllRequest;
import ai.chat2db.community.domain.api.model.request.runtime.DbConnectionContextRequest;
import ai.chat2db.community.domain.api.model.request.sql.DbExecutionDatasourceRequest;
import ai.chat2db.community.domain.api.model.sql.ExecutionDatasource;
import ai.chat2db.community.domain.api.model.sql.SimpleSqlStatement;
import ai.chat2db.community.domain.api.model.sql.StatementExecutionTarget;
import ai.chat2db.community.domain.api.service.db.IDbConnectionContextService;
import ai.chat2db.community.domain.api.service.db.IDbDatabaseService;
import ai.chat2db.community.domain.api.service.db.IDbSqlService;
import ai.chat2db.spi.DefaultMetaService;
import ai.chat2db.spi.IDbMetaData;
import ai.chat2db.spi.IPlugin;
import ai.chat2db.spi.model.datasource.ConnectInfo;
import ai.chat2db.spi.model.request.TablesRequest;
import ai.chat2db.spi.sql.Chat2DBContext;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers which datasource a statement is moved to, and - more importantly - when it is left alone.
 */
class DbExecutionDatasourceServiceImplTest {

    /**
     * Every world takes its own datasource ids: the table cache is a process-wide cache keyed by
     * datasource and database, so ids shared between tests would serve one test's metadata to another.
     */
    private static final AtomicLong DATA_SOURCE_IDS = new AtomicLong(10_000L);

    private static final String SQL = "SELECT * FROM verify_task;";

    private Map<String, IPlugin> originalPlugins;

    @BeforeEach
    void setUp() {
        originalPlugins = Map.copyOf(Chat2DBContext.PLUGIN_MAP);
        bindLog.clear();
    }

    @AfterEach
    void tearDown() {
        Chat2DBContext.removeContext();
        Chat2DBContext.PLUGIN_MAP.clear();
        Chat2DBContext.PLUGIN_MAP.putAll(originalPlugins);
    }

    @Test
    void keepsTheStatementWhenTheBoundDatabaseHoldsItsTables() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "verify_task").id();
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", SQL);

        assertFalse(result.located(), "the console's own database serves the statement");
    }

    @Test
    void keepsTheStatementWhenItIsNotAQuery() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.parse("UPDATE verify_task SET a = 1;", SqlTypeEnum.UPDATE, "verify_task");
        world.parse("DELETE FROM verify_task;", SqlTypeEnum.DELETE, "verify_task");
        world.parse("DROP TABLE verify_task;", SqlTypeEnum.DROP, "verify_task");

        assertFalse(world.resolve(bound, "db58_hbg_audit", "UPDATE verify_task SET a = 1;").located(),
                "a write belongs to the datasource the user chose");
        assertFalse(world.resolve(bound, "db58_hbg_audit", "DELETE FROM verify_task;").located());
        assertFalse(world.resolve(bound, "db58_hbg_audit", "DROP TABLE verify_task;").located());
        assertTrue(world.metadataReads.isEmpty(), "a statement that is not a query must not read any metadata");
    }

    @Test
    void keepsTheStatementWhenTheParserCannotClassifyIt() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.parseUnclassified(SQL, "verify_task");

        assertFalse(world.resolve(bound, "db58_hbg_audit", SQL).located(),
                "an unclassified statement is not proven to be a query");
    }

    @Test
    void keepsTheStatementWhenItNamesNoTable() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.parse("SELECT 1;", SqlTypeEnum.SELECT);

        assertFalse(world.resolve(bound, "db58_hbg_audit", "SELECT 1;").located());
    }

    @Test
    void keepsTheStatementWhenItAlreadyNamesADatabase() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.parseQualified(SQL, "other", null, "verify_task");

        assertFalse(world.resolve(bound, "db58_hbg_audit", SQL).located(),
                "the statement already decided where to read");
    }

    @Test
    void movesTheStatementToAnotherDatabaseOfTheBoundDatasource() {
        World world = new World();
        World.Datasource datasource = world.datasource("test-ajk-user03");
        datasource.database("db58_hbg_audit", "audit_log");
        datasource.database("db58_hbg_ccf", "verify_task");
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(datasource.id(), "db58_hbg_audit", SQL);

        assertTrue(result.located());
        assertEquals(Long.valueOf(datasource.id()), result.dataSourceId());
        assertEquals("db58_hbg_ccf", result.databaseName(), "the same connection already serves the table");
    }

    @Test
    void movesTheStatementToAnotherDatasourceAndReadsTheBoundOneFirst() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        World.Datasource other = world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.scopes.add(SqlCompletionScope.of(other.id(), null, null));
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", SQL);

        assertTrue(result.located());
        assertEquals(Long.valueOf(other.id()), result.dataSourceId());
        assertEquals("test-ajk-user02", result.dataSourceName(), "the response names the target for display");
        assertEquals("db58_hbg_ccf", result.databaseName());
        assertEquals(List.of(
                        // the statement is parsed against the console's own datasource,
                        "bind:" + bound + "/db58_hbg_audit",
                        "clear",
                        // its bound database is read,
                        "bind:" + bound + "/db58_hbg_audit",
                        "clear",
                        "bind:" + bound + "/db58_hbg_audit",
                        "clear",
                        // and only then is the other datasource opened and read.
                        "bind:" + other.id() + "/null",
                        "clear",
                        "bind:" + other.id() + "/db58_hbg_ccf",
                        "clear"),
                bindLog,
                "the bound datasource is read before the other one is tried");
    }

    @Test
    void findsAViewJustAsATable() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        World.Datasource other = world.datasource("test-ajk-user02").database("db58_hbg_ccf", "unrelated_table");
        other.view("verify_task_view", "db58_hbg_ccf");
        world.scopes.add(SqlCompletionScope.of(other.id(), null, null));
        world.parse("SELECT * FROM verify_task_view;", SqlTypeEnum.SELECT, "verify_task_view");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", "SELECT * FROM verify_task_view;");

        assertTrue(result.located(), "a query may read a view as readily as a table");
        assertEquals(Long.valueOf(other.id()), result.dataSourceId());
    }

    @Test
    void keepsTheStatementWhenItsTablesAreSplitAcrossTargets() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.datasource("test-ajk-user04").database("db58_hbg_ddd", "review_order");
        String sql = "SELECT * FROM verify_task JOIN review_order;";
        world.parse(sql, SqlTypeEnum.SELECT, "verify_task", "review_order");

        assertFalse(world.resolve(bound, "db58_hbg_audit", sql).located(),
                "no single connection serves both tables, so the console keeps the statement");
    }

    @Test
    void takesTheFirstScopeHoldingEveryTable() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        World.Datasource recent = world.datasource("recent-datasource").database("recent_db", "verify_task");
        World.Datasource later = world.datasource("tree-datasource").database("tree_db", "verify_task");
        world.scopes.add(SqlCompletionScope.of(recent.id(), null, null));
        world.scopes.add(SqlCompletionScope.of(later.id(), null, null));
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", SQL);

        assertEquals(Long.valueOf(recent.id()), result.dataSourceId(),
                "the scopes arrive most relevant first, and the first one holding the tables takes the statement");
    }

    @Test
    void skipsAnUnreachableScopeAndKeepsLooking() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        World.Datasource broken = world.datasource("broken-datasource").database("broken_db", "verify_task");
        World.Datasource other = world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.scopes.add(SqlCompletionScope.of(broken.id(), null, null));
        world.scopes.add(SqlCompletionScope.of(other.id(), null, null));
        world.unreachable.add(broken.id());
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", SQL);

        assertEquals(Long.valueOf(other.id()), result.dataSourceId(),
                "one unreachable datasource must not end the search");
    }

    @Test
    void doesNotStarveTheScopesBehindADatasourceWithManyDatabases() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        World.Datasource crowded = world.datasource("crowded-datasource");
        for (int index = 1; index <= 40; index++) {
            crowded.database("crowded_db_" + index, "filler_" + index);
        }
        world.scopes.add(SqlCompletionScope.of(crowded.id(), null, null));
        for (int index = 0; index < 5; index++) {
            World.Datasource filler = world.datasource("filler-datasource-" + index).database("filler_db", "filler");
            world.scopes.add(SqlCompletionScope.of(filler.id(), null, null));
        }
        World.Datasource last = world.datasource("last-datasource").database("last_db", "verify_task");
        world.scopes.add(SqlCompletionScope.of(last.id(), null, null));
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", SQL);

        assertTrue(result.located(), "the trailing datasource is still reached");
        assertEquals(Long.valueOf(last.id()), result.dataSourceId());
        assertTrue(world.metadataReads.size() <= 2 * DbExecutionDatasourceServiceImpl.MAX_SCOPE_DATABASES,
                "the resolve still reads no more pairs than its budget");
    }

    @Test
    void keepsTheStatementWhenNothingHoldsItsTables() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "some_other_table");
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");

        ExecutionDatasource result = world.resolve(bound, "db58_hbg_audit", SQL);

        assertFalse(result.located(), "an unknown table keeps today's behaviour, error included");
        assertNull(result.dataSourceId());
    }

    @Test
    void keepsTheStatementWhenNoDatasourceIsBound() {
        World world = new World();
        World.Datasource other = world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");
        DbExecutionDatasourceRequest request = world.request(SQL);
        request.setScopes(List.of(SqlCompletionScope.of(other.id(), null, null)));

        assertFalse(world.service().resolve(request).located(),
                "relocating a console with no datasource is not covered yet");
    }

    @Test
    void routesEachStatementToTheDatasourceHoldingItsTables() {
        World world = new World();
        long bound = world.datasource("test-ajk02").database("db58_hbg_governance", "video_base_info").id();
        World.Datasource ccf = world.datasource("test-ajk-user02").database("db58_hbg_ccf",
                "review_orders", "review_task");
        world.scopes.add(SqlCompletionScope.of(ccf.id(), null, null));
        String script = "SELECT * FROM video_base_info;\nSELECT * FROM review_orders;\nSELECT * FROM review_task;";
        world.parseScript(script,
                new World.ParsedStatement(SqlTypeEnum.SELECT.name(), new String[] {"video_base_info"}, null),
                new World.ParsedStatement(SqlTypeEnum.SELECT.name(), new String[] {"review_orders"}, null),
                new World.ParsedStatement(SqlTypeEnum.SELECT.name(), new String[] {"review_task"}, null));

        List<StatementExecutionTarget> targets =
                world.resolveStatementTargets(bound, "db58_hbg_governance", script);

        assertEquals(3, targets.size());
        StatementExecutionTarget first = targets.get(0);
        assertFalse(first.isRelocated(), "the bound database already holds its table");
        assertNull(first.getDataSourceId());
        assertNull(first.getDatabaseName());
        assertEquals(1, first.getSequence());

        StatementExecutionTarget second = targets.get(1);
        assertTrue(second.isRelocated(), "review_orders lives on another datasource");
        assertEquals(ccf.id(), second.getDataSourceId());
        assertEquals("test-ajk-user02", second.getDataSourceName());
        assertEquals("db58_hbg_ccf", second.getDatabaseName());
        assertEquals(2, second.getSequence());

        StatementExecutionTarget third = targets.get(2);
        assertTrue(third.isRelocated(), "review_task lives on the same other datasource");
        assertEquals(ccf.id(), third.getDataSourceId());
        assertEquals("db58_hbg_ccf", third.getDatabaseName());
        assertEquals(3, third.getSequence());
    }

    @Test
    void refusesToRouteAScriptHoldingAWrite() {
        World world = new World();
        long bound = world.datasource("test-ajk02").database("db58_hbg_governance", "video_base_info").id();
        World.Datasource ccf = world.datasource("test-ajk-user02").database("db58_hbg_ccf", "review_orders");
        world.scopes.add(SqlCompletionScope.of(ccf.id(), null, null));
        String script = "SELECT * FROM video_base_info;\nUPDATE review_orders SET a = 1;";
        world.parseScript(script,
                new World.ParsedStatement(SqlTypeEnum.SELECT.name(), new String[] {"video_base_info"}, null),
                new World.ParsedStatement(SqlTypeEnum.UPDATE.name(), new String[] {"review_orders"}, null));

        List<StatementExecutionTarget> targets =
                world.resolveStatementTargets(bound, "db58_hbg_governance", script);

        assertTrue(targets.isEmpty(), "a write anywhere in the script keeps the whole script on its binding");
    }

    @Test
    void refusesToRouteWhenAStatementNamesItsOwnDatabase() {
        World world = new World();
        long bound = world.datasource("test-ajk02").database("db58_hbg_governance", "video_base_info").id();
        World.Datasource ccf = world.datasource("test-ajk-user02").database("db58_hbg_ccf", "review_orders");
        world.scopes.add(SqlCompletionScope.of(ccf.id(), null, null));
        String script = "SELECT * FROM video_base_info;\nSELECT * FROM other_db.review_orders;";
        world.parseScript(script,
                new World.ParsedStatement(SqlTypeEnum.SELECT.name(), new String[] {"video_base_info"}, null),
                new World.ParsedStatement(SqlTypeEnum.SELECT.name(), new String[] {"review_orders"},
                        new String[] {"other_db", null}));

        List<StatementExecutionTarget> targets =
                world.resolveStatementTargets(bound, "db58_hbg_governance", script);

        assertTrue(targets.isEmpty(), "a statement that already names its database keeps the whole script");
    }

    @Test
    void leavesTheCallersBindingInPlaceAfterTheResolve() {
        World world = new World();
        long bound = world.datasource("test-ajk-user03").database("db58_hbg_audit", "audit_log").id();
        world.datasource("test-ajk-user02").database("db58_hbg_ccf", "verify_task");
        world.parse(SQL, SqlTypeEnum.SELECT, "verify_task");
        ConnectInfo callers = connectInfo(bound, "test-ajk-user03");
        Chat2DBContext.putContext(callers);
        try {
            world.resolve(bound, "db58_hbg_audit", SQL);

            assertSame(callers, Chat2DBContext.getConnectInfo(),
                    "a resolve on the execution thread must leave the binding the executor runs on");
        } finally {
            Chat2DBContext.removeContext();
        }
    }

    private static final String DB_TYPE = "MYSQL";

    private static final List<String> bindLog = new ArrayList<>();

    /**
     * One fake tree of datasources: each holds databases, each database holds tables, each datasource
     * may hold views. A parser stub reports what a statement was registered to reference.
     */
    private static final class World {

        private final Map<Long, Datasource> datasources = new LinkedHashMap<>();
        private final Map<String, ParsedStatement> parses = new LinkedHashMap<>();
        private final List<SqlCompletionScope> scopes = new ArrayList<>();
        private final Set<Long> unreachable = new HashSet<>();
        private final List<String> metadataReads = new ArrayList<>();

        private World() {
            registerPlugin();
        }

        private Datasource datasource(String name) {
            Datasource datasource = new Datasource(DATA_SOURCE_IDS.incrementAndGet(), name);
            datasources.put(datasource.dataSourceId, datasource);
            return datasource;
        }

        private void parse(String sql, SqlTypeEnum sqlType, String... tableNames) {
            parses.put(sql, new ParsedStatement(sqlType == null ? null : sqlType.name(), tableNames, null));
        }

        private void parseUnclassified(String sql, String... tableNames) {
            parses.put(sql, new ParsedStatement(null, tableNames, null));
        }

        private void parseQualified(String sql, String databaseName, String schemaName, String... tableNames) {
            parses.put(sql, new ParsedStatement(SqlTypeEnum.SELECT.name(), tableNames,
                    new String[] {databaseName, schemaName}));
        }

        private void parseScript(String script, ParsedStatement... statements) {
            parses.put(script, new ParsedStatement(null, new String[0], null, statements));
        }

        private DbExecutionDatasourceRequest request(String sql) {
            DbExecutionDatasourceRequest request = new DbExecutionDatasourceRequest();
            request.setConsoleId(1L);
            request.setSql(sql);
            request.setScopes(scopes);
            return request;
        }

        private ExecutionDatasource resolve(long dataSourceId, String databaseName, String sql) {
            DbExecutionDatasourceRequest request = request(sql);
            request.setDataSourceId(dataSourceId);
            request.setDatabaseName(databaseName);
            return service().resolve(request);
        }

        private List<StatementExecutionTarget> resolveStatementTargets(long dataSourceId, String databaseName, String sql) {
            DbExecutionDatasourceRequest request = request(sql);
            request.setDataSourceId(dataSourceId);
            request.setDatabaseName(databaseName);
            return service().resolveStatementTargets(request);
        }

        private DbExecutionDatasourceServiceImpl service() {
            return new DbExecutionDatasourceServiceImpl(sqlService(), connectionContext(), databaseService());
        }

        private IDbSqlService sqlService() {
            return (IDbSqlService) Proxy.newProxyInstance(IDbSqlService.class.getClassLoader(),
                    new Class<?>[] {IDbSqlService.class},
                    (proxy, method, args) -> {
                        if (!"parseAndValidTableStatements".equals(method.getName())) {
                            return null;
                        }
                        String sql = (String) args[0];
                        ParsedStatement parsed = parses.get(sql);
                        if (parsed == null) {
                            throw new IllegalStateException("the test did not register a parse for: " + sql);
                        }
                        if (parsed.statements() != null) {
                            List<SimpleSqlStatement> statements = new ArrayList<>(parsed.statements().length);
                            for (ParsedStatement child : parsed.statements()) {
                                statements.add(statement(sql, child));
                            }
                            return statements;
                        }
                        return List.of(statement(sql, parsed));
                    });
        }

        private SimpleSqlStatement statement(String sql, ParsedStatement parsed) {
            SimpleSqlStatement statement = new SimpleSqlStatement();
            statement.setSql(sql);
            statement.setSqlType(parsed.sqlType());
            List<SimpleSqlStatement.SimpleTable> tables = new ArrayList<>();
            for (String tableName : parsed.tableNames()) {
                SimpleSqlStatement.SimpleTable table = new SimpleSqlStatement.SimpleTable();
                table.setTableName(tableName);
                if (parsed.qualifiers() != null) {
                    table.setDatabaseName(parsed.qualifiers()[0]);
                    table.setSchemaName(parsed.qualifiers()[1]);
                }
                tables.add(table);
            }
            statement.setTables(tables);
            return statement;
        }

        private IDbDatabaseService databaseService() {
            return (IDbDatabaseService) Proxy.newProxyInstance(IDbDatabaseService.class.getClassLoader(),
                    new Class<?>[] {IDbDatabaseService.class},
                    (proxy, method, args) -> {
                        if (!"queryAll".equals(method.getName())) {
                            return null;
                        }
                        Datasource datasource = datasources.get(((DbDatabaseQueryAllRequest) args[0]).getDataSourceId());
                        if (datasource == null) {
                            return List.of();
                        }
                        List<Database> databases = new ArrayList<>();
                        for (String databaseName : datasource.tablesByDatabase.keySet()) {
                            databases.add(database(databaseName, false));
                        }
                        databases.add(database("information_schema", true));
                        return databases;
                    });
        }

        private IDbConnectionContextService connectionContext() {
            return (IDbConnectionContextService) Proxy.newProxyInstance(
                    IDbConnectionContextService.class.getClassLoader(),
                    new Class<?>[] {IDbConnectionContextService.class},
                    (proxy, method, args) -> {
                        switch (method.getName()) {
                            case "bind":
                                DbConnectionContextRequest request = (DbConnectionContextRequest) args[0];
                                Long dataSourceId = request.getDataSourceId();
                                if (unreachable.contains(dataSourceId)) {
                                    throw new IllegalStateException("datasource unreachable: " + dataSourceId);
                                }
                                bindLog.add("bind:" + dataSourceId + "/" + request.getDatabaseName());
                                Datasource datasource = datasources.get(dataSourceId);
                                Chat2DBContext.putContext(
                                        connectInfo(dataSourceId, datasource == null ? null : datasource.name));
                                return null;
                            case "clear":
                                bindLog.add("clear");
                                Chat2DBContext.removeContext();
                                return null;
                            case "equals":
                                return proxy == args[0];
                            case "hashCode":
                                return System.identityHashCode(proxy);
                            case "toString":
                                return "ExecutionDatasourceConnectionContextStub";
                            default:
                                return null;
                        }
                    });
        }

        private void registerPlugin() {
            DBConfig dbConfig = new DBConfig();
            dbConfig.setDbType(DB_TYPE);
            dbConfig.setSupportDatabase(true);
            dbConfig.setDefaultDriverConfig(new DriverConfig());
            Chat2DBContext.PLUGIN_MAP.put(DB_TYPE, new StaticPlugin(dbConfig, new StaticMetaData(this)));
        }

        /** One datasource of the fake tree. */
        private static final class Datasource {

            private final Long dataSourceId;
            private final String name;
            private final Map<String, List<String>> tablesByDatabase = new LinkedHashMap<>();
            private final List<String[]> views = new ArrayList<>();

            private Datasource(Long dataSourceId, String name) {
                this.dataSourceId = dataSourceId;
                this.name = name;
            }

            private long id() {
                return dataSourceId;
            }

            private Datasource database(String databaseName, String... tableNames) {
                tablesByDatabase.put(databaseName, List.of(tableNames));
                return this;
            }

            private Datasource view(String viewName, String databaseName) {
                views.add(new String[] {databaseName, viewName});
                return this;
            }
        }

        /** What the registered parse reports. */
        record ParsedStatement(String sqlType, String[] tableNames, String[] qualifiers,
                ParsedStatement[] statements) {

            ParsedStatement(String sqlType, String[] tableNames, String[] qualifiers) {
                this(sqlType, tableNames, qualifiers, null);
            }
        }
    }

    private static Database database(String name, boolean system) {
        Database database = new Database();
        database.setName(name);
        database.setSystem(system);
        return database;
    }

    private static ConnectInfo connectInfo(Long dataSourceId, String alias) {
        ConnectInfo connectInfo = new ConnectInfo();
        connectInfo.setDataSourceId(dataSourceId);
        connectInfo.setAlias(alias);
        connectInfo.setDbType(DB_TYPE);
        connectInfo.setDriverConfig(new DriverConfig());
        connectInfo.setConnection(fakeConnection());
        return connectInfo;
    }

    private static Connection fakeConnection() {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(),
                new Class<?>[] {Connection.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "close" -> null;
                    case "isClosed" -> false;
                    case "toString" -> "fake-connection";
                    default -> null;
                });
    }

    private static final class StaticPlugin implements IPlugin {

        private final DBConfig dbConfig;
        private final IDbMetaData metaData;

        private StaticPlugin(DBConfig dbConfig, IDbMetaData metaData) {
            this.dbConfig = dbConfig;
            this.metaData = metaData;
        }

        @Override
        public DBConfig getDBConfig() {
            return dbConfig;
        }

        @Override
        public IDbMetaData getDbMetaData() {
            return metaData;
        }
    }

    /**
     * Serves the tables and views of the datasource that is currently bound, recording every read.
     */
    private static final class StaticMetaData extends DefaultMetaService {

        private final World world;

        private StaticMetaData(World world) {
            this.world = world;
        }

        @Override
        public List<Table> tables(Connection connection, TablesRequest request) {
            world.metadataReads.add("tables");
            World.Datasource datasource = boundDatasource();
            List<String> tableNames = datasource == null ? List.of()
                    : datasource.tablesByDatabase.getOrDefault(request.getDatabaseName(), List.of());
            List<Table> tables = new ArrayList<>(tableNames.size());
            for (String tableName : tableNames) {
                tables.add(Table.builder().databaseName(request.getDatabaseName()).name(tableName).build());
            }
            return tables;
        }

        @Override
        public List<Table> views(Connection connection, String databaseName, String schemaName) {
            world.metadataReads.add("views");
            World.Datasource datasource = boundDatasource();
            if (datasource == null) {
                return List.of();
            }
            List<Table> views = new ArrayList<>();
            for (String[] view : datasource.views) {
                if (view[0].equals(databaseName)) {
                    views.add(Table.builder().databaseName(databaseName).name(view[1]).build());
                }
            }
            return views;
        }

        private World.Datasource boundDatasource() {
            ConnectInfo connectInfo = Chat2DBContext.getConnectInfo();
            return connectInfo == null ? null : world.datasources.get(connectInfo.getDataSourceId());
        }
    }
}
