package ai.chat2db.community.domain.core.impl.db;

import ai.chat2db.community.domain.api.config.DBConfig;
import ai.chat2db.community.domain.api.model.request.db.DbDlExecuteRequest;
import ai.chat2db.community.domain.api.model.request.runtime.DbConnectionContextRequest;
import ai.chat2db.community.domain.api.model.request.sql.DbExecutionDatasourceRequest;
import ai.chat2db.community.domain.api.model.result.ExecuteResponse;
import ai.chat2db.community.domain.api.model.result.ExecutionContext;
import ai.chat2db.community.domain.api.model.result.ResultCell;
import ai.chat2db.community.domain.api.model.sql.SqlExecuteRequest;
import ai.chat2db.community.domain.api.model.sql.StatementExecutionTarget;
import ai.chat2db.community.domain.api.service.db.IDbConnectionContextService;
import ai.chat2db.community.domain.api.service.db.IDbExecutionDatasourceService;
import ai.chat2db.community.domain.api.service.db.IDbStatementRoutingExecutor;
import ai.chat2db.community.domain.api.service.db.ISqlExecutionCancellation;
import ai.chat2db.community.domain.api.service.db.ISqlExecutionResultConsumer;
import ai.chat2db.spi.model.datasource.ConnectInfo;
import ai.chat2db.spi.sql.Chat2DBContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Runs a script statement by statement, each on the target that holds its tables.
 * <p>
 * The plan comes from {@link IDbExecutionDatasourceService}: one target per statement, the console's own
 * binding for every statement it already serves. Statements that keep the binding run the way they
 * always have; only the ones that leave it run alone, on a connection bound to the target that was
 * located for them, with the console's binding restored the moment they are done.
 * <p>
 * Every result a relocated statement produces is marked with the target it ran against, so a console
 * cannot mistake a routed result for one of its own binding's.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class DbStatementRoutingExecutorImpl implements IDbStatementRoutingExecutor {

    private final IDbExecutionDatasourceService executionDatasourceService;

    private final IDbConnectionContextService connectionContextService;

    @Override
    public List<StatementExecutionTarget> plan(DbDlExecuteRequest request, String processedSql) {
        if (request == null || request.getDataSourceId() == null || StringUtils.isBlank(processedSql)) {
            return Collections.emptyList();
        }
        ConnectInfo connectInfo = Chat2DBContext.getConnectInfo();
        if (connectInfo == null) {
            return Collections.emptyList();
        }
        DBConfig dbConfig = Chat2DBContext.getDBConfig();
        if (dbConfig == null || (!dbConfig.isSupportDatabase() && !dbConfig.isSupportSchema())) {
            // A datasource with a single object space has nowhere to route to.
            return Collections.emptyList();
        }
        try {
            List<StatementExecutionTarget> targets =
                    executionDatasourceService.resolveStatementTargets(routingRequest(request, processedSql));
            // A relocated target without a database to run on cannot leave the binding; keep it where it was.
            for (StatementExecutionTarget target : targets) {
                if (target.isRelocated() && StringUtils.isBlank(target.getDatabaseName())) {
                    target.setRelocated(false);
                    target.setDataSourceId(null);
                    target.setDataSourceName(null);
                    target.setDatabaseName(null);
                }
            }
            return targets;
        } catch (Exception e) { // impl-contract: fallback - a failed plan keeps the script on the console's binding.
            log.debug("statement routing plan failed for datasource {}", request.getDataSourceId(), e);
            return Collections.emptyList();
        }
    }

    @Override
    public List<ExecuteResponse> execute(DbDlExecuteRequest request, SqlExecuteRequest template,
            List<StatementExecutionTarget> plan, StatementRunner runner) throws Exception {
        ConnectInfo bound = Chat2DBContext.getConnectInfo();
        List<ExecuteResponse> results = new ArrayList<>();
        for (StatementExecutionTarget target : plan) {
            List<ExecuteResponse> statementResults = runWithTarget(request, target, bound,
                    () -> runner.execute(singleCommand(template, target, bound)));
            if (CollectionUtils.isEmpty(statementResults)) {
                continue;
            }
            results.addAll(statementResults);
            if (!Boolean.TRUE.equals(request.getErrorContinue()) && failed(statementResults)) {
                break;
            }
        }
        return results;
    }

    @Override
    public void stream(DbDlExecuteRequest request, SqlExecuteRequest template,
            List<StatementExecutionTarget> plan, ISqlExecutionCancellation cancellation,
            ISqlExecutionResultConsumer consumer, StreamingStatementRunner runner) throws Exception {
        ConnectInfo bound = Chat2DBContext.getConnectInfo();
        for (StatementExecutionTarget target : plan) {
            if (cancellation != null && cancellation.isCanceled()) {
                break;
            }
            RoutingConsumer routingConsumer = new RoutingConsumer(consumer, target);
            runWithTarget(request, target, bound, () -> {
                runner.execute(singleCommand(template, target, bound), routingConsumer);
                return null;
            });
            if (routingConsumer.failed() && !Boolean.TRUE.equals(request.getErrorContinue())) {
                break;
            }
        }
    }

    /**
     * Runs one statement's work, binding the target's context first when the statement leaves the
     * console's binding, and putting the binding back whatever the statement did.
     */
    private <T> T runWithTarget(DbDlExecuteRequest request, StatementExecutionTarget target, ConnectInfo bound,
            TargetBody<T> body) throws Exception {
        if (!target.isRelocated()) {
            return body.run();
        }
        try {
            bindTarget(request, target);
            return body.run();
        } finally {
            // Release the connection the statement borrowed and put the console's own binding back.
            Chat2DBContext.removeContext();
            if (bound != null) {
                Chat2DBContext.putContext(bound);
            }
        }
    }

    @FunctionalInterface
    private interface TargetBody<T> {

        T run() throws Exception;
    }

    private void bindTarget(DbDlExecuteRequest request, StatementExecutionTarget target) {
        DbConnectionContextRequest param = new DbConnectionContextRequest();
        param.setDataSourceId(target.getDataSourceId());
        param.setDatabaseName(target.getDatabaseName());
        param.setSchemaName(target.getSchemaName());
        param.setConsoleId(request.getConsoleId());
        connectionContextService.bind(param);
    }

    private SqlExecuteRequest singleCommand(SqlExecuteRequest template, StatementExecutionTarget target,
            ConnectInfo bound) {
        SqlExecuteRequest command = new SqlExecuteRequest();
        command.setScript(target.getSql());
        command.setConsoleId(template.getConsoleId());
        command.setTableName(template.getTableName());
        command.setPageNo(template.getPageNo());
        command.setPageSize(template.getPageSize());
        command.setPageSizeAll(template.getPageSizeAll());
        command.setSingle(true);
        command.setResultSetId(template.getResultSetId());
        command.setErrorContinue(template.getErrorContinue());
        command.setExplain(template.isExplain());
        if (target.isRelocated()) {
            command.setDataSourceId(target.getDataSourceId());
            command.setDatabaseName(StringUtils.defaultString(target.getDatabaseName()));
            command.setSchemaName(target.getSchemaName());
        } else {
            command.setDataSourceId(template.getDataSourceId());
            if (bound != null) {
                command.setDatabaseName(bound.getDatabaseName());
                command.setSchemaName(bound.getSchemaName());
            } else {
                command.setDatabaseName(template.getDatabaseName());
                command.setSchemaName(template.getSchemaName());
            }
        }
        return command;
    }

    private DbExecutionDatasourceRequest routingRequest(DbDlExecuteRequest request, String processedSql) {
        DbExecutionDatasourceRequest param = new DbExecutionDatasourceRequest();
        param.setConsoleId(request.getConsoleId());
        param.setSql(processedSql);
        param.setDataSourceId(request.getDataSourceId());
        param.setDatabaseName(request.getDatabaseName());
        param.setSchemaName(request.getSchemaName());
        param.setScopes(request.getScopes());
        return param;
    }

    private boolean failed(List<ExecuteResponse> results) {
        for (ExecuteResponse result : results) {
            if (result != null && !Boolean.TRUE.equals(result.getSuccess())) {
                return true;
            }
        }
        return false;
    }

    /**
     * A consumer that reports every result of one routed statement under the statement's script position,
     * carries the target the statement ran against, and remembers whether the statement failed.
     */
    private static final class RoutingConsumer implements ISqlExecutionResultConsumer {

        private final ISqlExecutionResultConsumer delegate;
        private final int sequence;
        private final Long dataSourceId;
        private final String dataSourceName;
        private final String databaseName;

        private boolean failed;

        RoutingConsumer(ISqlExecutionResultConsumer delegate, StatementExecutionTarget target) {
            this.delegate = delegate;
            this.sequence = target.getSequence();
            this.dataSourceId = target.isRelocated() ? target.getDataSourceId() : null;
            this.dataSourceName = target.isRelocated() ? target.getDataSourceName() : null;
            this.databaseName = target.isRelocated() ? target.getDatabaseName() : null;
        }

        boolean failed() {
            return failed;
        }

        @Override
        public void statementStarted(String sql, String originalSql, String comment) {
            delegate.statementStarted(sql, originalSql, comment);
        }

        @Override
        public void resultStarted(ExecuteResponse result) {
            stamp(result);
            delegate.resultStarted(result);
        }

        @Override
        public void rows(ExecuteResponse result, List<List<ResultCell>> rows) {
            stamp(result);
            delegate.rows(result, rows);
        }

        @Override
        public void resultFinished(ExecuteResponse result) {
            stamp(result);
            delegate.resultFinished(result);
        }

        @Override
        public void updateCount(ExecuteResponse result) {
            stamp(result);
            delegate.updateCount(result);
        }

        @Override
        public void statementFinished(String sql, long duration) {
            delegate.statementFinished(sql, duration);
        }

        private void stamp(ExecuteResponse result) {
            if (result == null) {
                return;
            }
            result.setStatementSequence(sequence);
            if (dataSourceId != null) {
                ExecutionContext context = result.getExecutionContext();
                if (context == null) {
                    context = new ExecutionContext();
                    result.setExecutionContext(context);
                }
                context.setDataSourceId(dataSourceId);
                context.setDataSourceName(dataSourceName);
                context.setAutoLocated(true);
                if (StringUtils.isBlank(context.getDatabaseName())) {
                    context.setDatabaseName(databaseName);
                }
            }
            if (result.getSuccess() != null && !result.getSuccess()) {
                failed = true;
            }
        }
    }
}
