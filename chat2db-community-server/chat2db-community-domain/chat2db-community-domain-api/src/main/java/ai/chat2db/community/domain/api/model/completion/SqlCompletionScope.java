package ai.chat2db.community.domain.api.model.completion;

/**
 * One datasource scope of an unbound SQL completion fan-out.
 * <p>
 * A scope names the datasource to complete against; when {@code databaseName} is blank every
 * database of that datasource is covered.
 *
 * @param dataSourceId datasource to read metadata from.
 * @param databaseName optional database; blank means all databases of the datasource.
 * @param schemaName optional schema of the datasource.
 */
public record SqlCompletionScope(Long dataSourceId, String databaseName, String schemaName) {

    /**
     * Builds a scope.
     *
     * @param dataSourceId datasource to read metadata from.
     * @param databaseName optional database; blank means all databases of the datasource.
     * @param schemaName optional schema of the datasource.
     * @return scope instance.
     */
    public static SqlCompletionScope of(Long dataSourceId, String databaseName, String schemaName) {
        return new SqlCompletionScope(dataSourceId, databaseName, schemaName);
    }
}
