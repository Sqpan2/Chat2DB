package ai.chat2db.community.domain.api.service.db;

import ai.chat2db.community.domain.api.model.request.sql.DbExecutionDatasourceRequest;
import ai.chat2db.community.domain.api.model.sql.ExecutionDatasource;

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
}
