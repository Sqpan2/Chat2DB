package ai.chat2db.community.domain.core.impl.ai;

import ai.chat2db.community.domain.api.model.request.ai.AiExecuteSqlRequest;
import ai.chat2db.community.domain.api.model.runtime.ConnectionProfile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefaultAiSqlAutoExecutionPolicyTest {

    private final DefaultAiSqlAutoExecutionPolicy policy = new DefaultAiSqlAutoExecutionPolicy();

    @ParameterizedTest
    @ValueSource(strings = {"INSERT", "UPDATE", "DELETE", "insert", " Update "})
    void dmlStatementsAreAutoExecuted(String sqlType) {
        assertTrue(allow(sqlType));
    }

    @Test
    void multiStatementScriptIsAutoExecutedWhenEveryStatementIsDml() {
        assertTrue(allow("INSERT", "UPDATE", "DELETE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"DROP", "CREATE_TABLE", "ALTER_TABLE", "TRUNCATE_TABLE", "MERGE", "REPLACE_INTO",
            "SELECT_INTO"})
    void ddlAndOtherWriteStatementsKeepManualConfirmation(String sqlType) {
        assertFalse(allow(sqlType));
    }

    @Test
    void mixedScriptKeepsManualConfirmation() {
        assertFalse(allow("INSERT", "DROP"));
    }

    @Test
    void missingOrBlankSqlTypeKeepsManualConfirmation() {
        assertFalse(policy.allowNonQueryExecution(request(), profile(), null));
        assertFalse(policy.allowNonQueryExecution(request(), profile(), List.of()));
        assertFalse(allow(""));
        assertFalse(allow("   "));
    }

    private boolean allow(String... sqlTypes) {
        return policy.allowNonQueryExecution(request(), profile(), Arrays.asList(sqlTypes));
    }

    private AiExecuteSqlRequest request() {
        return new AiExecuteSqlRequest();
    }

    private ConnectionProfile profile() {
        return new ConnectionProfile();
    }
}
