package ai.chat2db.community.domain.api.service.db;

import ai.chat2db.community.domain.api.model.completion.result.SqlCompletionResponse;
import ai.chat2db.community.domain.api.model.request.sql.DbSqlUnboundCompletionRequest;

/**
 * Produces SQL completion candidates for an editor that has no datasource bound.
 */
public interface IDbSqlUnboundCompletionService {

    /**
     * Builds merged SQL completion candidates across the requested datasource scopes.
     *
     * @param dbSqlUnboundCompletionRequest unbound completion request parameters.
     * @return completion result containing the merged candidates.
     */
    SqlCompletionResponse complete(DbSqlUnboundCompletionRequest dbSqlUnboundCompletionRequest);
}
