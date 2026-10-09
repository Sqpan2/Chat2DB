package ai.chat2db.community.domain.api.model.result;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ExecutionContext {

    private String databaseName;

    private String schemaName;

    /**
     * The datasource the statement really ran against, set when it was routed away from the console's
     * own binding; the console reports it so a relocated statement cannot masquerade as a local one.
     */
    private Long dataSourceId;

    private String dataSourceName;

    /**
     * Whether the statement was moved to another datasource or database because the tables it names
     * live there.
     */
    private Boolean autoLocated;
}
