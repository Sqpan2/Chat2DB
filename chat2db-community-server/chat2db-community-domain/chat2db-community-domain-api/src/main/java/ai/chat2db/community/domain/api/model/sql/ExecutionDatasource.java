package ai.chat2db.community.domain.api.model.sql;

/**
 * Datasource a statement is to be executed against, when that is not the datasource the console is
 * bound to.
 * <p>
 * The schema is deliberately absent: a relocated statement runs against the datasource's own default
 * schema, because the schema of the console belongs to the binding the statement was moved away from.
 *
 * @param dataSourceId datasource to execute against; {@code null} when the console's own binding keeps the statement.
 * @param dataSourceName alias of that datasource, for display.
 * @param databaseName database to execute against.
 */
public record ExecutionDatasource(Long dataSourceId, String dataSourceName, String databaseName) {

    /**
     * The console's own binding keeps the statement.
     *
     * @return result carrying no datasource.
     */
    public static ExecutionDatasource none() {
        return new ExecutionDatasource(null, null, null);
    }

    /**
     * The statement is to be executed against another datasource or database.
     *
     * @param dataSourceId datasource to execute against.
     * @param dataSourceName alias of that datasource.
     * @param databaseName database to execute against.
     * @return result naming that target.
     */
    public static ExecutionDatasource of(Long dataSourceId, String dataSourceName, String databaseName) {
        return new ExecutionDatasource(dataSourceId, dataSourceName, databaseName);
    }

    /**
     * @return whether the statement is to be moved away from the console's binding.
     */
    public boolean located() {
        return dataSourceId != null;
    }
}
