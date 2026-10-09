package ai.chat2db.plugin.mysql;

import ai.chat2db.community.domain.api.config.DBConfig;
import ai.chat2db.community.domain.api.config.DriverConfig;
import ai.chat2db.community.domain.api.enums.parser.SqlTypeEnum;
import ai.chat2db.community.domain.api.model.sql.SimpleSqlStatement;
import ai.chat2db.spi.IPlugin;
import ai.chat2db.plugin.mysql.MysqlSyntaxPlugin;
import ai.chat2db.spi.model.datasource.ConnectInfo;
import ai.chat2db.spi.sql.Chat2DBContext;
import ai.chat2db.spi.util.SqlUtils;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Pins what resolving an execution datasource depends on: which statements the MySQL parser calls
 * queries, and which tables it reports them as reading.
 * <p>
 * {@code IDbSqlService.parseAndValidTableStatements} delegates straight to
 * {@link SqlUtils#parseAndValidTableStatements(String, String)}, so this is the parser the resolve
 * service sees. Note that the parser reads the bound context, and reports fully qualified names as
 * such, so the resolve service has to leave a statement that already names its database alone.
 */
class MysqlExecutionDatasourceParsingTest {

    private static final String DB_TYPE = "MYSQL";

    private Map<String, IPlugin> originalPlugins;

    @BeforeEach
    void setUp() {
        originalPlugins = Map.copyOf(Chat2DBContext.PLUGIN_MAP);
        Chat2DBContext.removeContext();
        // The dialect's own grammar is what decides whether a statement is a query, so the parser is
        // loaded from the plugin exactly as the server loads it, rather than through the fallback.
        registerSyntaxPlugin();
    }

    /**
     * Publishes the MySQL syntax plugin the way the server does, before the syntax handler reads the
     * plugin map for the first time.
     */
    private static void registerSyntaxPlugin() {
        IPlugin syntaxPlugin = (IPlugin) Proxy.newProxyInstance(
                IPlugin.class.getClassLoader(),
                new Class<?>[] {IPlugin.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getSqlSyntaxPlugin" -> new MysqlSyntaxPlugin();
                    case "getDBConfig" -> dbConfig();
                    case "equals" -> proxy == args[0];
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "toString" -> "MysqlSyntaxPluginHolder";
                    default -> null;
                });
        Chat2DBContext.PLUGIN_MAP.put(DB_TYPE, syntaxPlugin);
    }

    @AfterEach
    void tearDown() {
        Chat2DBContext.removeContext();
        Chat2DBContext.PLUGIN_MAP.clear();
        Chat2DBContext.PLUGIN_MAP.putAll(originalPlugins);
    }

    @Test
    void reportsAQueryAndTheUnqualifiedTablesItReads() {
        bind();

        List<SimpleSqlStatement> statements = SqlUtils.parseAndValidTableStatements("SELECT * FROM verify_task;", DB_TYPE);

        Assertions.assertEquals(1, statements.size());
        Assertions.assertEquals(SqlTypeEnum.SELECT.name(), statements.get(0).getSqlType());
        Assertions.assertNotNull(statements.get(0).getTables(), "a query names the tables it reads");
        Assertions.assertEquals(1, statements.get(0).getTables().size());
        SimpleSqlStatement.SimpleTable table = statements.get(0).getTables().get(0);
        Assertions.assertEquals("verify_task", table.getTableName());
        Assertions.assertNull(table.getDatabaseName(), "an unqualified table leaves its database to the target");
        Assertions.assertNull(table.getSchemaName());
    }

    @Test
    void reportsEveryTableOfAJoin() {
        bind();

        List<SimpleSqlStatement> statements =
                SqlUtils.parseAndValidTableStatements("SELECT * FROM verify_task JOIN review_order;", DB_TYPE);

        Assertions.assertEquals(
                List.of("review_order", "verify_task"),
                statements.get(0).getTables().stream()
                        .map(SimpleSqlStatement.SimpleTable::getTableName)
                        .sorted()
                        .toList());
    }

    @Test
    void reportsAQualifiedTableAsQualified() {
        bind();

        List<SimpleSqlStatement> statements =
                SqlUtils.parseAndValidTableStatements("SELECT * FROM other_db.verify_task;", DB_TYPE);

        SimpleSqlStatement.SimpleTable table = statements.get(0).getTables().get(0);
        Assertions.assertEquals("verify_task", table.getTableName());
        Assertions.assertEquals("other_db", table.getDatabaseName(),
                "a statement that names its database is left to read that database");
    }

    @Test
    void reportsAWriteAsSomethingOtherThanAQuery() {
        bind();

        for (String sql : List.of("UPDATE verify_task SET a = 1;", "DELETE FROM verify_task;", "DROP TABLE verify_task;")) {
            List<SimpleSqlStatement> statements = SqlUtils.parseAndValidTableStatements(sql, DB_TYPE);
            Assertions.assertNotEquals(SqlTypeEnum.SELECT.name(), statements.get(0).getSqlType(),
                    sql + " must never move to another datasource");
        }
    }

    private static DBConfig dbConfig() {
        DBConfig dbConfig = new DBConfig();
        dbConfig.setDbType(DB_TYPE);
        dbConfig.setSupportDatabase(true);
        dbConfig.setDefaultDriverConfig(new DriverConfig());
        return dbConfig;
    }

    private static void bind() {
        registerSyntaxPlugin();

        ConnectInfo connectInfo = new ConnectInfo();
        connectInfo.setDataSourceId(1L);
        connectInfo.setDbType(DB_TYPE);
        connectInfo.setDriverConfig(new DriverConfig());
        connectInfo.setConnection(fakeConnection());
        Chat2DBContext.putContext(connectInfo);
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
}
