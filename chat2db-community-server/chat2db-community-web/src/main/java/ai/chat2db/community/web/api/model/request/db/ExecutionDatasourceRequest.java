package ai.chat2db.community.web.api.model.request.db;

import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Asks which datasource to execute a statement against, for a console that may reach several datasources.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ExecutionDatasourceRequest {

    private Long consoleId;

    @NotBlank
    private String sql;

    /** Datasource the console is bound to. */
    private Long dataSourceId;

    /** Database the console is bound to; blank means a datasource was chosen without a database. */
    private String databaseName;

    /** Schema the console is bound to. */
    private String schemaName;

    /** Datasources to try, most relevant first, the console's own binding included. */
    @Valid
    private List<SqlCompletionScope> scopes;
}
