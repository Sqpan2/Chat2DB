package ai.chat2db.community.domain.api.model.request.sql;

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
 * Completion request for an editor that has no datasource bound.
 * <p>
 * The scopes carry the datasources to fan out over, most relevant first; the service merges the
 * candidates they produce into a single completion result.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class DbSqlUnboundCompletionRequest {

    private Long consoleId;
    @NotBlank
    private String sql;
    @NotNull
    @Min(0)
    private Integer cursor;
    @Min(0)
    private Integer minPrefixLength;
    private Boolean needFullName;
    private String keywordCase;
    @Valid
    private SqlCompletionActiveSnippetSlot activeSnippetSlot;
    @Valid
    private List<SqlCompletionScope> scopes;
}
