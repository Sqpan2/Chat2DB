package ai.chat2db.community.domain.api.service.db;

import ai.chat2db.community.domain.api.model.request.sql.DbExecutionDatasourceRequest;
import ai.chat2db.community.domain.api.model.sql.ExecutionDatasource;
import ai.chat2db.community.domain.api.model.sql.StatementExecutionTarget;

import java.util.List;

/**
 * Decides which datasource a statement has to be executed against.
 * <p>
 * A console is bound to one datasource, but its statements - and the completion that writes them - may
 * reach every datasource the tree offers. A read-only statement naming tables its own binding cannot
 * serve is therefore moved to the datasource that holds them.
 */
public interface IDbExecutionDatasourceService {

    /**
     * Resolves the datasource a statement should run against.
     *
     * @param dbExecutionDatasourceRequest statement and the datasources it may be moved to.
     * @return the datasource to execute against, or {@link ExecutionDatasource#none()} when the console's
     * own binding keeps the statement.
     */
    ExecutionDatasource resolve(DbExecutionDatasourceRequest dbExecutionDatasourceRequest);

    /**
     * Resolves a target for every statement of a script independently, so a script whose statements
     * read different databases can run as it stands, each statement where its tables live.
     * <p>
     * Only queries are ever routed, and only when every statement of the script is one: a write keeps
     * the whole script on the console's binding, the same rule the single-statement resolve follows.
     *
     * @param dbExecutionDatasourceRequest script and the datasources it may be moved to.
     * @return one target per statement, in script order; empty when the script cannot be routed and
     * must run as one piece on the console's binding.
     */
    List<StatementExecutionTarget> resolveStatementTargets(DbExecutionDatasourceRequest dbExecutionDatasourceRequest);
}
