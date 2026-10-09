package ai.chat2db.community.domain.api.service.db;

import ai.chat2db.community.domain.api.model.request.db.DbDlExecuteRequest;
import ai.chat2db.community.domain.api.model.result.ExecuteResponse;
import ai.chat2db.community.domain.api.model.sql.SqlExecuteRequest;
import ai.chat2db.community.domain.api.model.sql.StatementExecutionTarget;

import java.util.List;

/**
 * Runs a script statement by statement, each on the target that holds its tables.
 * <p>
 * A console is bound to one datasource and database, but a script may name tables that live elsewhere:
 * in another database of the bound datasource, or on another datasource the console reaches. A routed
 * script runs every statement where its tables are and keeps each result attached to the target that
 * produced it, so the console can report what really ran.
 * <p>
 * Only read-only scripts are ever routed: one write keeps the whole script on the console's binding.
 */
public interface IDbStatementRoutingExecutor {

    /**
     * Plans a target for every statement of the processed script.
     *
     * @param request the execution request carrying the console's binding and the datasources it reaches.
     * @param processedSql the script after the execution policies have rewritten it.
     * @return one target per statement, in script order; empty when the script is not routable and runs
     * as one piece on the console's binding.
     */
    List<StatementExecutionTarget> plan(DbDlExecuteRequest request, String processedSql);

    /**
     * Executes the routed script, statement by statement, and collects the results in script order.
     * <p>
     * The runner executes one statement under the context the router has bound; every failure stops the
     * run unless the request asks to continue past errors. Each statement runs a copy of the template
     * command carrying only that statement's script and target.
     *
     * @param request the execution request.
     * @param template the processed command of the whole script, carrying the policies' parameters.
     * @param plan targets for every statement, from {@link #plan}.
     * @param runner executes one statement's command under the current context.
     * @return the results of the statements that ran, in script order.
     */
    List<ExecuteResponse> execute(DbDlExecuteRequest request, SqlExecuteRequest template,
            List<StatementExecutionTarget> plan, StatementRunner runner) throws Exception;

    /**
     * Streams the routed script, statement by statement, through the given consumer.
     * <p>
     * The consumer handed to the runner reports each result under the statement's script position and
     * carries the target the statement ran against, so results of a routed run keep the order and the
     * identity of the statements that produced them.
     *
     * @param request the execution request.
     * @param template the processed command of the whole script, carrying the policies' parameters.
     * @param plan targets for every statement, from {@link #plan}.
     * @param cancellation cancellation the run honours between statements.
     * @param consumer the consumer every statement streams through.
     * @param runner streams one statement's command under the context the router has bound.
     */
    void stream(DbDlExecuteRequest request, SqlExecuteRequest template, List<StatementExecutionTarget> plan,
            ISqlExecutionCancellation cancellation, ISqlExecutionResultConsumer consumer,
            StreamingStatementRunner runner) throws Exception;

    /**
     * Executes one statement's command under the context the router has bound.
     */
    @FunctionalInterface
    interface StatementRunner {

        List<ExecuteResponse> execute(SqlExecuteRequest command);
    }

    /**
     * Streams one statement's command under the context the router has bound.
     */
    @FunctionalInterface
    interface StreamingStatementRunner {

        void execute(SqlExecuteRequest command, ISqlExecutionResultConsumer consumer) throws Exception;
    }
}
