package ai.chat2db.spi.syntax;

import ai.chat2db.spi.ISqlSyntaxPlugin;

import ai.chat2db.community.domain.api.enums.parser.DatabaseTypeEnum;
import ai.chat2db.community.domain.api.model.parser.position.TokenPosition;
import ai.chat2db.community.domain.api.model.parser.result.SqlParserResponse;
import ai.chat2db.community.domain.api.model.parser.statement.Statement;
import ai.chat2db.community.domain.api.model.parser.statement.create.CreateTableStatement;
import ai.chat2db.community.domain.api.service.task.ITaskProgressListener;
import ai.chat2db.spi.ISQLParser;
import ai.chat2db.community.domain.api.service.db.ISqlBatchHandler;
import ai.chat2db.spi.ISqlCompletionProvider;
import ai.chat2db.community.domain.api.model.completion.request.DbSqlCompletionRequest;
import ai.chat2db.community.domain.api.model.completion.result.SqlCompletionResponse;
import ai.chat2db.community.domain.api.enums.completion.SqlCompletionCandidateTypeEnum;
import ai.chat2db.community.domain.api.enums.completion.SqlCompletionStatusEnum;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionCandidate;
import ai.chat2db.spi.DefaultSqlSyntaxHandler;
import org.antlr.v4.runtime.Token;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

class DefaultSqlSyntaxHandlerCompletionTest {

    private final Map<String, ISqlSyntaxPlugin> pluginMap = pluginMap();
    private final ISqlSyntaxPlugin previousPostgresqlPlugin = pluginMap.get(DatabaseTypeEnum.POSTGRESQL.name());
    private final ISqlSyntaxPlugin previousMysqlPlugin = pluginMap.get(DatabaseTypeEnum.MYSQL.name());
    private final ISqlSyntaxPlugin previousTidbPlugin = pluginMap.get(DatabaseTypeEnum.TIDB.name());

    @AfterEach
    void restorePluginMap() {
        if (previousPostgresqlPlugin == null) {
            pluginMap.remove(DatabaseTypeEnum.POSTGRESQL.name());
        } else {
            pluginMap.put(DatabaseTypeEnum.POSTGRESQL.name(), previousPostgresqlPlugin);
        }
        if (previousMysqlPlugin == null) {
            pluginMap.remove(DatabaseTypeEnum.MYSQL.name());
        } else {
            pluginMap.put(DatabaseTypeEnum.MYSQL.name(), previousMysqlPlugin);
        }
        if (previousTidbPlugin == null) {
            pluginMap.remove(DatabaseTypeEnum.TIDB.name());
        } else {
            pluginMap.put(DatabaseTypeEnum.TIDB.name(), previousTidbPlugin);
        }
    }

    @Test
    void completeDelegatesToDialectCompletionProviderOnce() {
        CountingCompletionProvider provider = new CountingCompletionProvider();
        pluginMap.put(DatabaseTypeEnum.POSTGRESQL.name(), new FakeSyntaxPlugin(provider));
        DbSqlCompletionRequest request = DbSqlCompletionRequest.of(
                "select * from app_user where na",
                31,
                DatabaseTypeEnum.POSTGRESQL.name(),
                1,
                null);

        SqlCompletionResponse result = DefaultSqlSyntaxHandler.complete(request);

        Assertions.assertEquals(1, provider.callCount);
        Assertions.assertSame(request, provider.lastRequest);
        Assertions.assertEquals(SqlCompletionStatusEnum.SUCCESS.name(), result.getStatus());
        Assertions.assertEquals(1, result.getCandidates().size());
        Assertions.assertEquals("name", result.getCandidates().get(0).getLabel());
    }

    @Test
    void completeReturnsUnsupportedWhenDialectPluginIsMissing() {
        pluginMap.remove(DatabaseTypeEnum.POSTGRESQL.name());
        DbSqlCompletionRequest request = DbSqlCompletionRequest.of(
                "select * from app_user",
                8,
                DatabaseTypeEnum.POSTGRESQL.name(),
                1,
                null);

        SqlCompletionResponse result = DefaultSqlSyntaxHandler.complete(request);

        Assertions.assertEquals(SqlCompletionStatusEnum.UNSUPPORTED.name(), result.getStatus());
        Assertions.assertEquals("sql.completion.unsupported.POSTGRESQL", result.getReasonCode());
    }

    @Test
    void completeUsesDefaultUnsupportedProviderWhenPluginHasNoCompletionProvider() {
        pluginMap.put(DatabaseTypeEnum.POSTGRESQL.name(), new DefaultCompletionSyntaxPlugin());
        DbSqlCompletionRequest request = DbSqlCompletionRequest.of(
                "select * from app_user",
                8,
                DatabaseTypeEnum.POSTGRESQL.name(),
                1,
                null);

        SqlCompletionResponse result = DefaultSqlSyntaxHandler.complete(request);

        Assertions.assertEquals(SqlCompletionStatusEnum.UNSUPPORTED.name(), result.getStatus());
        Assertions.assertEquals("sql.completion.unsupported.POSTGRESQL", result.getReasonCode());
    }

    @Test
    void completeFallsBackToMysqlProviderForMysqlProtocolFamilyDialect() {
        CountingCompletionProvider mysqlProvider = new CountingCompletionProvider();
        pluginMap.put(DatabaseTypeEnum.MYSQL.name(),
                new FakeSyntaxPlugin(DatabaseTypeEnum.MYSQL.name(), mysqlProvider));
        pluginMap.put(DatabaseTypeEnum.TIDB.name(), new DefaultCompletionSyntaxPlugin(DatabaseTypeEnum.TIDB.name()));

        DbSqlCompletionRequest request = DbSqlCompletionRequest.of(
                "select * from app_user where na",
                31,
                DatabaseTypeEnum.TIDB.name(),
                1,
                null);

        SqlCompletionResponse result = DefaultSqlSyntaxHandler.complete(request);

        Assertions.assertEquals(1, mysqlProvider.callCount);
        Assertions.assertEquals(SqlCompletionStatusEnum.SUCCESS.name(), result.getStatus());
        Assertions.assertEquals("name", result.getCandidates().get(0).getLabel());
    }

    @Test
    void completeKeepsNonMysqlFamilyDialectOnItsOwnDefaultProvider() {
        pluginMap.put(DatabaseTypeEnum.POSTGRESQL.name(), new DefaultCompletionSyntaxPlugin());
        DbSqlCompletionRequest request = DbSqlCompletionRequest.of(
                "select * from app_user",
                8,
                DatabaseTypeEnum.POSTGRESQL.name(),
                1,
                null);

        SqlCompletionResponse result = DefaultSqlSyntaxHandler.complete(request);

        Assertions.assertEquals(SqlCompletionStatusEnum.UNSUPPORTED.name(), result.getStatus());
        Assertions.assertEquals("sql.completion.unsupported.POSTGRESQL", result.getReasonCode());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, ISqlSyntaxPlugin> pluginMap() {
        try {
            Field field = DefaultSqlSyntaxHandler.class.getDeclaredField("sqlSyntaxPluginMap");
            field.setAccessible(true);
            return (Map<String, ISqlSyntaxPlugin>) field.get(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static final class CountingCompletionProvider implements ISqlCompletionProvider {

        private int callCount;
        private DbSqlCompletionRequest lastRequest;

        @Override
        public SqlCompletionResponse complete(DbSqlCompletionRequest request) {
            callCount++;
            lastRequest = request;
            SqlCompletionCandidate candidate = SqlCompletionCandidate.of(
                    SqlCompletionCandidateTypeEnum.COLUMN, "name");
            return SqlCompletionResponse.success(request.cursor() - 2, request.cursor(), new ArrayList<>(List.of(candidate)));
        }
    }

    private static final class FakeSyntaxPlugin implements ISqlSyntaxPlugin {

        private final String databaseType;
        private final ISqlCompletionProvider completionProvider;

        private FakeSyntaxPlugin(ISqlCompletionProvider completionProvider) {
            this(DatabaseTypeEnum.POSTGRESQL.name(), completionProvider);
        }

        private FakeSyntaxPlugin(String databaseType, ISqlCompletionProvider completionProvider) {
            this.databaseType = databaseType;
            this.completionProvider = completionProvider;
        }

        @Override
        public String getDatabaseType() {
            return databaseType;
        }

        @Override
        public ISQLParser getSQLParser() {
            return new UnsupportedSqlParser();
        }

        @Override
        public ISqlCompletionProvider getSqlCompletionProvider() {
            return completionProvider;
        }
    }

    private static final class DefaultCompletionSyntaxPlugin implements ISqlSyntaxPlugin {

        private final String databaseType;

        private DefaultCompletionSyntaxPlugin() {
            this(DatabaseTypeEnum.POSTGRESQL.name());
        }

        private DefaultCompletionSyntaxPlugin(String databaseType) {
            this.databaseType = databaseType;
        }

        @Override
        public String getDatabaseType() {
            return databaseType;
        }

        @Override
        public ISQLParser getSQLParser() {
            return new UnsupportedSqlParser();
        }
    }

    private static final class UnsupportedSqlParser implements ISQLParser {

        @Override
        public SqlParserResponse parserStatements(String sql) {
            throw unsupported();
        }

        @Override
        public SqlParserResponse simpleParserStatements(String sql) {
            throw unsupported();
        }

        @Override
        public List<Token> getAllTokens(String sql) {
            throw unsupported();
        }

        @Override
        public List<Token> getAllTokensOnDefault(String sql) {
            throw unsupported();
        }

        @Override
        public Map<TokenPosition, Token> getTokenPositionMap(String sql) {
            throw unsupported();
        }

        @Override
        public CreateTableStatement parserCreateTableStatement(String sql) {
            throw unsupported();
        }

        @Override
        public Set<String> getSqlStartKeywords() {
            throw unsupported();
        }

        @Override
        public boolean isSelect(String sql) {
            throw unsupported();
        }

        @Override
        public List<Statement> parserSqlScript(String sql) {
            throw unsupported();
        }

        @Override
        public int parserSqlScript(File file, ITaskProgressListener progressListener, ISqlBatchHandler sqlBatchHandler) {
            throw unsupported();
        }

        @Override
        public SqlParserResponse validTableStatements(String sql) {
            throw unsupported();
        }

        private static UnsupportedOperationException unsupported() {
            return new UnsupportedOperationException("parser should not be used by completion contract tests");
        }
    }
}
