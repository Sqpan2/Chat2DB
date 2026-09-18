package ai.chat2db.community.domain.core.impl.ai;

import ai.chat2db.community.domain.api.model.request.ai.AiExecuteSqlRequest;
import ai.chat2db.community.domain.api.model.runtime.ConnectionProfile;
import ai.chat2db.community.domain.api.service.ai.IAiSqlAutoExecutionPolicy;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.Set;

@Component
public class DefaultAiSqlAutoExecutionPolicy implements IAiSqlAutoExecutionPolicy {

    /**
     * DML statements AI tools may auto-execute. DDL and any other non-query type still requires manual confirmation.
     */
    private static final Set<String> AUTO_EXECUTABLE_DML_TYPES = Set.of("INSERT", "UPDATE", "DELETE");

    @Override
    public boolean allowNonQueryExecution(
        AiExecuteSqlRequest request,
        ConnectionProfile profile,
        List<String> sqlTypes
    ) {
        if (sqlTypes == null || sqlTypes.isEmpty()) {
            return false;
        }
        // impl-contract: allow only when every statement in the script is DML; mixed scripts need manual confirmation.
        return sqlTypes.stream().allMatch(DefaultAiSqlAutoExecutionPolicy::isAutoExecutableDml);
    }

    private static boolean isAutoExecutableDml(String sqlType) {
        if (sqlType == null || sqlType.isBlank()) {
            return false;
        }
        return AUTO_EXECUTABLE_DML_TYPES.contains(sqlType.trim().toUpperCase(Locale.ROOT));
    }
}
