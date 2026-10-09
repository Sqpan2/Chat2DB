package ai.chat2db.community.web.api.model.request.db;

import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import ai.chat2db.community.web.api.model.request.data.source.IDataSourceSchemaRequestInfo;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

@Data
public class SqlEditorExecuteRequest implements IDataSourceSchemaRequestInfo {

    @NotNull
    private Long dataSourceId;

    private String databaseName;

    private String schemaName;

    @NotBlank
    private String sql;

    private Long consoleId;

    private Long applyId;

    @Min(1)
    private Integer pageNo;

    @Min(1)
    private Integer pageSize;

    private boolean single;

    private Integer resultSetId;

    private Boolean errorContinue;

    private boolean explain;

    /**
     * Datasources the console can reach besides its own binding, most relevant first. They widen the
     * search when a statement names tables the bound datasource does not hold.
     */
    @Valid
    private List<SqlCompletionScope> scopes;
}
