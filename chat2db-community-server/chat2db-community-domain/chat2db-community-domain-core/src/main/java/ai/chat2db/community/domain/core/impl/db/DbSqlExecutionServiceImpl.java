package ai.chat2db.community.domain.core.impl.db;

import ai.chat2db.community.domain.api.model.sql.SqlExecuteRequest;
import ai.chat2db.community.domain.api.model.request.db.DbStreamingExecuteRequest;
import ai.chat2db.community.domain.api.model.request.db.DbDlExecuteRequest;
import ai.chat2db.community.domain.api.model.sql.StatementExecutionTarget;
import ai.chat2db.community.domain.api.model.sql.extension.SqlExecutionContext;
import ai.chat2db.community.domain.api.model.sql.extension.SqlExecutionOperation;
import ai.chat2db.community.domain.api.model.sql.extension.SqlExecutionPlan;
import ai.chat2db.community.domain.api.service.db.IDbSqlCommandService;
import ai.chat2db.community.domain.api.service.db.IDbSqlExecutionService;
import ai.chat2db.community.domain.api.service.db.IDbStatementRoutingExecutor;
import ai.chat2db.community.domain.api.service.db.ISqlExecutionResultConsumer;
import ai.chat2db.community.domain.core.impl.db.extension.SqlExecutionPolicyManager;
import ai.chat2db.community.tools.util.I18nUtils;
import ai.chat2db.spi.ICommandExecutor;
import ai.chat2db.spi.model.datasource.ConnectInfo;
import ai.chat2db.spi.sql.Chat2DBContext;
import ai.chat2db.spi.DefaultSQLExecutor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import java.sql.SQLException;
import java.util.List;

@Service
public class DbSqlExecutionServiceImpl implements IDbSqlExecutionService {

    private final IDbSqlCommandService sqlSqlExecuteRequestService;
    private final SqlExecutionPolicyManager sqlExecutionPolicyManager;
    private final IDbStatementRoutingExecutor statementRoutingExecutor;

    public DbSqlExecutionServiceImpl(IDbSqlCommandService sqlSqlExecuteRequestService,
            SqlExecutionPolicyManager sqlExecutionPolicyManager,
            IDbStatementRoutingExecutor statementRoutingExecutor) {
        this.sqlSqlExecuteRequestService = sqlSqlExecuteRequestService;
        this.sqlExecutionPolicyManager = sqlExecutionPolicyManager;
        this.statementRoutingExecutor = statementRoutingExecutor;
    }

    @Override
    public void executeStreaming(DbStreamingExecuteRequest executeStreamingRequest) throws SQLException {
        DbDlExecuteRequest request = executeStreamingRequest.getDlExecuteRequest();
        if (StringUtils.isBlank(request.getSql())) {
            return;
        }
        ICommandExecutor executor = Chat2DBContext.getDbMetaData().getCommandExecutor();
        if (!(executor instanceof DefaultSQLExecutor sqlExecutor)) {
            throw new IllegalStateException(I18nUtils.getMessage("sqlExecution.streamingUnsupported"));
        }
        if (executeStreamingRequest.getCancellation() != null
                && executeStreamingRequest.getCancellation().isCanceled()) {
            throw new SQLException("SQL execution canceled");
        }
        SqlExecutionPlan executionPlan = sqlExecutionPolicyManager.plan(executionContext(request),
                executeStreamingRequest.getExecutionId());
        SqlExecuteRequest command = sqlSqlExecuteRequestService.toSqlExecuteRequest(request);
        command.setScript(executionPlan.getSql());
        sqlExecutionPolicyManager.applyMaxRows(command, executionPlan);
        sqlExecutionPolicyManager.beforeExecute(executionPlan);
        ISqlExecutionResultConsumer consumer = sqlExecutionPolicyManager.wrapStreamingConsumer(executionPlan,
                executeStreamingRequest.getConsumer());
        // A read-only script whose statements read different databases streams each statement where its
        // tables are; anything unroutable keeps streaming as one piece on the console's binding.
        List<StatementExecutionTarget> routingPlan = statementRoutingExecutor.plan(request, executionPlan.getSql());
        if (routingPlan.isEmpty()) {
            sqlExecutor.executeStreaming(command, consumer,
                    executeStreamingRequest.getStatementListener(), executeStreamingRequest.getCancellation());
        } else {
            try {
                statementRoutingExecutor.stream(request, command, routingPlan,
                        executeStreamingRequest.getCancellation(), consumer,
                        (single, routingConsumer) -> sqlExecutor.executeStreaming(single, routingConsumer,
                                executeStreamingRequest.getStatementListener(),
                                executeStreamingRequest.getCancellation()));
            } catch (SQLException e) {
                throw e;
            } catch (Exception e) { // impl-contract: fallback - only the executor's failures reach this point.
                throw new SQLException(e.getMessage(), e);
            }
        }
    }

    private SqlExecutionContext executionContext(DbDlExecuteRequest request) {
        ConnectInfo connectInfo = Chat2DBContext.getConnectInfo();
        return new SqlExecutionContext(
                connectInfo == null ? request.getDataSourceId() : connectInfo.getDataSourceId(),
                connectInfo == null ? null : connectInfo.getDbType(),
                request.getDatabaseName(), request.getSchemaName(), request.getTableName(), request.getSql(),
                SqlExecutionOperation.EXECUTE, null, request.getApplyId());
    }
}
