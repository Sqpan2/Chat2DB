package ai.chat2db.community.domain.api.model.request.sql;

import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Asks which datasource a statement should be executed against.
 * <p>
 * The console's own binding arrives as {@code dataSourceId}/{@code databaseName}/{@code schemaName} and is
 * always tried first; {@code scopes} carries the datasources to fall back to, most relevant first, and
 * never repeats the bound one.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class DbExecutionDatasourceRequest {

    private Long consoleId;

    @NotBlank
    private String sql;

    /** Datasource the console is bound to. */
    private Long dataSourceId;

    /** Database the console is bound to; blank means the datasource was chosen without a database. */
    private String databaseName;

    /** Schema the console is bound to. */
    private String schemaName;

    /** Datasources to try after the bound one, most relevant first. */
    @Valid
    private List<SqlCompletionScope> scopes;
}
