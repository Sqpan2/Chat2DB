package ai.chat2db.community.web.api.model.request.db;

import ai.chat2db.community.domain.api.model.completion.SqlCompletionActiveSnippetSlot;
import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Completion request for an editor with no datasource bound, carrying the scopes to fan out over.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class UnboundSqlCompletionRequest {

    private Long consoleId;

    @NotBlank
    private String sql;

    @NotNull
    @Min(0)
    private Integer cursor;

    private String beforeSql;

    private String afterSql;

    private Boolean needFullName;

    private String keywordCase;

    private SqlCompletionActiveSnippetSlot activeSnippetSlot;

    @Valid
    private List<SqlCompletionScope> scopes;
}
