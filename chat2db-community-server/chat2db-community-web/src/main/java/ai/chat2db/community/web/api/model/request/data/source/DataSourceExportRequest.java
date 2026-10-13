package ai.chat2db.community.web.api.model.request.data.source;

import lombok.Data;

import java.util.List;

@Data
public class DataSourceExportRequest {

    private List<Long> datasourceIds;

    /**
     * When {@code true}, sensitive fields (password, host, url, user) are exported in plaintext so the
     * file can be imported on another machine with credentials intact. Defaults to {@code false}.
     */
    private Boolean includePassword;
}
