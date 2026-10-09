package ai.chat2db.community.domain.api.model.request.db;


import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import lombok.Data;

import java.util.List;

/**
 * Internal carrier populated after endpoint-specific request validation.
 */
@Data
public class DbDlExecuteRequest {


    private String sql;


    private Long consoleId;


    private Long applyId;


    private Long dataSourceId;


    private String databaseName;


    private String schemaName;


    private String tableName;


    private Integer pageNo;


    private Integer pageSize;


    private Boolean pageSizeAll;


    private boolean single;


    private Integer resultSetId;

    private Boolean errorContinue;

    private boolean explain;

    /**
     * Datasources the console can reach besides its own binding, most relevant first. They are the
     * search space for routing a statement to a target that actually holds its tables.
     */
    private List<SqlCompletionScope> scopes;
}
