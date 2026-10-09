package ai.chat2db.community.domain.core.impl.db;

import ai.chat2db.community.domain.api.config.DBConfig;
import ai.chat2db.community.domain.api.config.DriverConfig;
import ai.chat2db.community.domain.api.enums.completion.SqlCompletionCandidateTypeEnum;
import ai.chat2db.community.domain.api.enums.completion.SqlCompletionEditorHintTypeEnum;
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
import ai.chat2db.spi.DefaultMetaService;
import ai.chat2db.spi.IDbMetaData;
import ai.chat2db.spi.IPlugin;
import ai.chat2db.spi.model.datasource.ConnectInfo;
import ai.chat2db.spi.sql.Chat2DBContext;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DbSqlUnboundCompletionServiceImplTest {

    private Map<String, IPlugin> originalPlugins;

    @BeforeEach
    void setUp() {
        originalPlugins = Map.copyOf(Chat2DBContext.PLUGIN_MAP);
        bindLog.clear();
        registerPlugin(false, List.of());
    }

    @AfterEach
    void tearDown() {
        Chat2DBContext.removeContext();
        Chat2DBContext.PLUGIN_MAP.clear();
        Chat2DBContext.PLUGIN_MAP.putAll(originalPlugins);
    }

    @Test
    void rejectsARequestWithoutUsableScopes() {
        StubCompletionService completionService = new StubCompletionService();
        DbSqlUnboundCompletionServiceImpl service = newService(completionService);

        assertEquals(SqlCompletionStatusEnum.REJECTED.name(),
                service.complete(request(List.of())).getStatus());
        assertEquals(SqlCompletionStatusEnum.REJECTED.name(),
                service.complete(request(List.of(SqlCompletionScope.of(null, "db_a", null)))).getStatus());
        assertTrue(completionService.calls.isEmpty(), "no metadata read may happen without a scope");
    }

    @Test
    void mergesEveryScopeKeepingTheHighestPriorityOccurrenceOfADuplicateLabel() {
        StubCompletionService completionService = new StubCompletionService();
        SqlCompletionCandidate priorityOrders = candidate(SqlCompletionCandidateTypeEnum.TABLE, "orders");
        priorityOrders.setDatasourceName("primary");
        completionService.respond("1/db_a",
                success(priorityOrders, candidate(SqlCompletionCandidateTypeEnum.TABLE, "users")));
        completionService.respond("2/db_b", success(
                candidate(SqlCompletionCandidateTypeEnum.TABLE, "orders"),
                candidate(SqlCompletionCandidateTypeEnum.TABLE, "items")));

        SqlCompletionResponse response = newService(completionService).complete(request(List.of(
                SqlCompletionScope.of(1L, "db_a", null),
                SqlCompletionScope.of(2L, "db_b", null))));

        assertEquals(SqlCompletionStatusEnum.SUCCESS.name(), response.getStatus());
        assertEquals(List.of("orders", "users", "items"), labels(response));
        assertSame(priorityOrders, response.getCandidates().get(0),
                "the priority datasource owns the surviving duplicate");
        assertEquals("primary", response.getCandidates().get(0).getDatasourceName());
    }

    @Test
    void readsScopesInPriorityOrderAndOrdersLaterScopesLast() {
        StubCompletionService completionService = new StubCompletionService();
        completionService.respond("1/db_a", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "alpha")));
        completionService.respond("2/db_b", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "beta")));
        completionService.respond("3/db_c", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "gamma")));

        SqlCompletionResponse response = newService(completionService).complete(request(List.of(
                SqlCompletionScope.of(1L, "db_a", null),
                SqlCompletionScope.of(2L, "db_b", null),
                SqlCompletionScope.of(3L, "db_c", null))));

        assertEquals(List.of("1/db_a", "2/db_b", "3/db_c"), completionService.calls);
        assertEquals(List.of("alpha", "beta", "gamma"), labels(response));
        assertEquals(List.of("000", "001", "002"), sortTexts(response));
    }

    @Test
    void readsADatasourceOnceEvenWhenTheClientRepeatsIt() {
        StubCompletionService completionService = new StubCompletionService();
        completionService.respond("1/db_a", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "alpha")));

        newService(completionService).complete(request(List.of(
                SqlCompletionScope.of(1L, "db_a", null),
                SqlCompletionScope.of(1L, "db_a", null))));

        assertEquals(List.of("1/db_a"), completionService.calls);
    }

    @Test
    void expandsAScopeWithoutADatabaseToEveryNonSystemDatabase() {
        registerPlugin(true, List.of(database("app"), systemDatabase("information_schema"), database("ops")));
        StubCompletionService completionService = new StubCompletionService();
        completionService.respond("1/app", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "orders")));
        completionService.respond("1/ops", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "audit")));

        SqlCompletionResponse response = newService(completionService)
                .complete(request(List.of(SqlCompletionScope.of(1L, null, null))));

        assertEquals(List.of("1/app", "1/ops"), completionService.calls,
                "system databases are not completion targets");
        assertEquals(List.of("orders", "audit"), labels(response));
    }

    @Test
    void keepsCollectingAfterAnUnreachableDatasource() {
        StubCompletionService completionService = new StubCompletionService();
        completionService.respond("2/db_b", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "items")));

        SqlCompletionResponse response = newService(completionService, Set.of(1L)).complete(request(List.of(
                SqlCompletionScope.of(1L, "db_a", null),
                SqlCompletionScope.of(2L, "db_b", null))));

        assertEquals(SqlCompletionStatusEnum.SUCCESS.name(), response.getStatus());
        assertEquals(List.of("items"), labels(response));
        assertEquals(List.of("2/db_b"), completionService.calls);
    }

    @Test
    void skipsAFailingDatabaseAndBindsAndClearsTheContextForEveryPair() {
        registerPlugin(true, List.of(database("db_a"), database("db_b")));
        StubCompletionService completionService = new StubCompletionService();
        completionService.fail("1/db_b");
        completionService.respond("1/db_a", success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "alpha")));

        SqlCompletionResponse response = newService(completionService)
                .complete(request(List.of(SqlCompletionScope.of(1L, null, null))));

        assertEquals(List.of("alpha"), labels(response));
        assertEquals(List.of("bind:1/null", "clear", "bind:1/db_a", "clear", "bind:1/db_b", "clear"), bindLog,
                "the scope is bound once to list its databases, then once per database read");
    }

    @Test
    void stopsCollectingOnceTheDatasourceBudgetIsSpent() {
        StubCompletionService completionService = new StubCompletionService();
        List<SqlCompletionScope> scopes = new ArrayList<>();
        for (int index = 1; index <= 40; index++) {
            String databaseName = "db_" + index;
            scopes.add(SqlCompletionScope.of((long) index, databaseName, null));
            completionService.respond(index + "/" + databaseName,
                    success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "table_" + index)));
        }

        SqlCompletionResponse response = newService(completionService).complete(request(scopes));

        assertEquals(DbSqlUnboundCompletionServiceImpl.MAX_SCOPES, completionService.calls.size());
        assertEquals(DbSqlUnboundCompletionServiceImpl.MAX_SCOPES, response.getCandidates().size());
    }

    @Test
    void holdsABudgetShareBackForEveryScopeSoTheTrailingDatasourcesAreStillRead() {
        List<Database> manyDatabases = new ArrayList<>();
        for (int index = 1; index <= 30; index++) {
            manyDatabases.add(database("db_" + index));
        }
        registerPlugin(true, manyDatabases);
        StubCompletionService completionService = new StubCompletionService();
        List<SqlCompletionScope> scopes = new ArrayList<>();
        for (int index = 1; index <= 12; index++) {
            scopes.add(SqlCompletionScope.of((long) index, null, null));
        }

        newService(completionService).complete(request(scopes));

        assertEquals(DbSqlUnboundCompletionServiceImpl.MAX_SCOPE_DATABASES, completionService.calls.size(),
                "the fan-out still reads no more pairs than its budget");
        assertEquals(12, completionService.calls.stream()
                        .map(call -> call.substring(0, call.indexOf('/')))
                        .distinct()
                        .count(),
                "one datasource reading many databases must not starve the ones behind it");
    }

    @Test
    void keepsTheReplaceOffsetsOfTheFirstScope() {
        StubCompletionService completionService = new StubCompletionService();
        completionService.respond("1/db_a", success(3, 7, candidate(SqlCompletionCandidateTypeEnum.TABLE, "alpha")));
        completionService.respond("2/db_b", success(9, 11, candidate(SqlCompletionCandidateTypeEnum.TABLE, "beta")));

        SqlCompletionResponse response = newService(completionService).complete(request(List.of(
                SqlCompletionScope.of(1L, "db_a", null),
                SqlCompletionScope.of(2L, "db_b", null))));

        assertEquals(3, response.getReplaceStart());
        assertEquals(7, response.getReplaceEnd());
    }

    @Test
    void mergeRewritesCollidingCandidateIdsAndKeepsEmptyResultsOut() {
        DbSqlUnboundCompletionServiceImpl.Merge merge = new DbSqlUnboundCompletionServiceImpl.Merge();
        SqlCompletionCandidate first = candidate(SqlCompletionCandidateTypeEnum.TABLE, "orders");
        first.setId("table:orders");
        SqlCompletionCandidate second = candidate(SqlCompletionCandidateTypeEnum.COLUMN, "id");
        second.setId("table:orders");
        merge.add(success(first), "primary");
        merge.add(SqlCompletionResponse.empty(), "ignored");
        merge.add(success(second), "secondary");

        SqlCompletionResponse response = merge.toResponse();

        assertEquals(List.of("orders", "id"), labels(response));
        assertEquals("table:orders", response.getCandidates().get(0).getId());
        assertEquals("2:table:orders", response.getCandidates().get(1).getId());
        assertEquals(List.of("000", "002"), sortTexts(response),
                "a scope that produced nothing still advances the scope ordering");
        assertEquals("secondary", response.getCandidates().get(1).getDatasourceName());
    }

    @Test
    void mergeReportsAnEmptyResultWhenNothingWasCollected() {
        DbSqlUnboundCompletionServiceImpl.Merge merge = new DbSqlUnboundCompletionServiceImpl.Merge();

        merge.add(SqlCompletionResponse.rejected("boom"), "primary");

        assertEquals(SqlCompletionStatusEnum.EMPTY.name(), merge.toResponse().getStatus());
    }

    @Test
    void keepsTheEditorHintsOfTheMostRelevantScopeThatHasThem() {
        SqlCompletionResponse hintless = success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "alpha"));
        SqlCompletionEditorHint hint = new SqlCompletionEditorHint();
        hint.setType(SqlCompletionEditorHintTypeEnum.INSERT_VALUE);
        SqlCompletionResponse hinted = success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "beta"));
        hinted.setEditorHints(new ArrayList<>(List.of(hint)));
        SqlCompletionResponse alsoHinted = success(candidate(SqlCompletionCandidateTypeEnum.TABLE, "gamma"));
        SqlCompletionEditorHint laterHint = new SqlCompletionEditorHint();
        laterHint.setType(SqlCompletionEditorHintTypeEnum.ROUTINE_PARAMETER);
        alsoHinted.setEditorHints(new ArrayList<>(List.of(laterHint)));

        DbSqlUnboundCompletionServiceImpl.Merge merge = new DbSqlUnboundCompletionServiceImpl.Merge();
        merge.add(hintless, "primary");
        merge.add(hinted, "secondary");
        merge.add(alsoHinted, "tertiary");

        SqlCompletionResponse response = merge.toResponse();

        assertEquals(List.of("alpha", "beta", "gamma"), labels(response));
        assertEquals(List.of(hint), response.getEditorHints(),
                "a console bound to a datasource keeps the hints that datasource produces");
    }

    @Test
    void mergeReportsEditorHintsEvenWhenNoScopeProducedCandidates() {
        SqlCompletionEditorHint hint = new SqlCompletionEditorHint();
        hint.setType(SqlCompletionEditorHintTypeEnum.INSERT_VALUE);
        SqlCompletionResponse hinted = SqlCompletionResponse.empty();
        hinted.setEditorHints(new ArrayList<>(List.of(hint)));

        DbSqlUnboundCompletionServiceImpl.Merge merge = new DbSqlUnboundCompletionServiceImpl.Merge();
        merge.add(hinted, "primary");

        SqlCompletionResponse response = merge.toResponse();

        assertEquals(List.of(hint), response.getEditorHints(),
                "the value picker of an insert statement must survive an empty candidate list");
    }

    private static DbSqlUnboundCompletionServiceImpl newService(StubCompletionService completionService) {
        return newService(completionService, Set.of());
    }

    private static DbSqlUnboundCompletionServiceImpl newService(StubCompletionService completionService,
                                                                Set<Long> unreachable) {
        return new DbSqlUnboundCompletionServiceImpl(completionService, connectionContext(unreachable));
    }

    private static DbSqlUnboundCompletionRequest request(List<SqlCompletionScope> scopes) {
        DbSqlUnboundCompletionRequest request = new DbSqlUnboundCompletionRequest();
        request.setConsoleId(1L);
        request.setSql("select * from ");
        request.setCursor(14);
        request.setScopes(scopes);
        return request;
    }

    private static SqlCompletionResponse success(SqlCompletionCandidate... candidates) {
        return success(0, 0, candidates);
    }

    private static SqlCompletionResponse success(int replaceStart, int replaceEnd,
                                                 SqlCompletionCandidate... candidates) {
        return SqlCompletionResponse.success(replaceStart, replaceEnd, new ArrayList<>(List.of(candidates)));
    }

    private static SqlCompletionCandidate candidate(SqlCompletionCandidateTypeEnum type, String label) {
        return SqlCompletionCandidate.of(type, label);
    }

    private static List<String> labels(SqlCompletionResponse response) {
        return response.getCandidates().stream().map(SqlCompletionCandidate::getLabel).toList();
    }

    private static List<String> sortTexts(SqlCompletionResponse response) {
        return response.getCandidates().stream().map(SqlCompletionCandidate::getSortText).toList();
    }

    private static void registerPlugin(boolean supportDatabase, List<Database> databases) {
        DBConfig dbConfig = new DBConfig();
        dbConfig.setDbType(DB_TYPE);
        dbConfig.setSupportDatabase(supportDatabase);
        dbConfig.setDefaultDriverConfig(new DriverConfig());
        IDbMetaData metaData = new StaticMetaData(databases);
        Chat2DBContext.PLUGIN_MAP.put(DB_TYPE, new StaticPlugin(dbConfig, metaData));
    }

    private static Database database(String name) {
        Database database = new Database();
        database.setName(name);
        return database;
    }

    private static Database systemDatabase(String name) {
        Database database = database(name);
        database.setSystem(true);
        return database;
    }

    private static final String DB_TYPE = "MYSQL";

    private static final List<String> bindLog = new ArrayList<>();

    /**
     * Records the metadata reads the fan-out performs, keyed by {@code dataSourceId/databaseName}.
     */
    private static final class StubCompletionService implements IDbSqlCompletionService {

        private final Map<String, SqlCompletionResponse> responses = new LinkedHashMap<>();
        private final Set<String> failures = new HashSet<>();
        private final List<String> calls = new ArrayList<>();

        private void respond(String key, SqlCompletionResponse response) {
            responses.put(key, response);
        }

        private void fail(String key) {
            failures.add(key);
        }

        @Override
        public SqlCompletionResponse complete(DbSqlCompletionGetRequest request) {
            String key = request.getDataSourceId() + "/" + request.getDatabaseName();
            calls.add(key);
            if (failures.contains(key)) {
                throw new IllegalStateException("metadata read failed for " + key);
            }
            return responses.getOrDefault(key, SqlCompletionResponse.empty());
        }
    }

    /**
     * Stands in for the real connection context: datasource ids in {@code unreachable} refuse to bind.
     */
    private static IDbConnectionContextService connectionContext(Set<Long> unreachable) {
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
                            return putContext(dataSourceId);
                        case "clear":
                            bindLog.add("clear");
                            Chat2DBContext.removeContext();
                            return null;
                        case "equals":
                            return proxy == args[0];
                        case "hashCode":
                            return System.identityHashCode(proxy);
                        case "toString":
                            return "UnboundCompletionConnectionContextStub";
                        default:
                            return null;
                    }
                });
    }

    private static Void putContext(Long dataSourceId) {
        Chat2DBContext.putContext(connectInfo(dataSourceId));
        return null;
    }

    private static ConnectInfo connectInfo(Long dataSourceId) {
        ConnectInfo connectInfo = new ConnectInfo();
        connectInfo.setDataSourceId(dataSourceId);
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

    private static final class StaticMetaData extends DefaultMetaService {

        private final List<Database> databases;

        private StaticMetaData(List<Database> databases) {
            this.databases = databases;
        }

        @Override
        public List<Database> databases(Connection connection) {
            return databases;
        }
    }
}
