package ai.chat2db.community.domain.api.model.sql;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Where one statement of a script is to run, as the executor routes it.
 * <p>
 * A routed script runs statement by statement, each on the target that holds its tables: the console's
 * own binding, or a datasource/database located for that statement alone.
 */
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class StatementExecutionTarget {

    /** Statement text, executable as it stands. */
    private String sql;

    /** Original statement text before any execution rewriting. */
    private String originalSql;

    /** One-based position of the statement in the script. */
    private int sequence;

    /**
     * Datasource to execute against; {@code null} keeps the console's own binding. A target datasource
     * equal to the bound one also keeps the binding, even when the database differs.
     */
    private Long dataSourceId;

    /** Alias of the target datasource, for display. */
    private String dataSourceName;

    /** Database to execute against; {@code null} keeps the bound database. */
    private String databaseName;

    /** Schema to execute against; {@code null} keeps the bound schema. */
    private String schemaName;

    /** Whether the statement leaves the console's own binding. */
    private boolean relocated;
}
