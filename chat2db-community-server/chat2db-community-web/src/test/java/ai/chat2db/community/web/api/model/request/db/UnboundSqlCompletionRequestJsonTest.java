package ai.chat2db.community.web.api.model.request.db;

import ai.chat2db.community.domain.api.enums.completion.SqlCompletionSnippetSlotTypeEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Pins the JSON the client sends for a fanned-out completion request: the scope list is the part
 * that decides which datasources are read, so a renamed or dropped field must fail here rather
 * than silently narrow the fan-out at runtime.
 */
class UnboundSqlCompletionRequestJsonTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void bindsTheScopesAndTheBoundDatasourceTheClientSends() throws Exception {
        String json = "{"
                + "\"consoleId\": 42,"
                + "\"sql\": \"select * from \","
                + "\"cursor\": 14,"
                + "\"beforeSql\": \"select * from \","
                + "\"afterSql\": \"\","
                + "\"needFullName\": true,"
                + "\"keywordCase\": \"UPPER\","
                + "\"activeSnippetSlot\": {\"type\": \"INSERT_COLUMN_LIST\", \"replaceStart\": 14, \"replaceEnd\": 14},"
                + "\"scopes\": ["
                + "{\"dataSourceId\": 7, \"databaseName\": \"app\", \"schemaName\": \"s1\"},"
                + "{\"dataSourceId\": 1}"
                + "]"
                + "}";

        UnboundSqlCompletionRequest request =
                objectMapper.readValue(json, UnboundSqlCompletionRequest.class);

        assertEquals(Long.valueOf(42L), request.getConsoleId());
        assertEquals("select * from ", request.getSql());
        assertEquals(Integer.valueOf(14), request.getCursor());
        assertEquals("select * from ", request.getBeforeSql());
        assertEquals(Boolean.TRUE, request.getNeedFullName());
        assertEquals("UPPER", request.getKeywordCase());
        assertNotNull(request.getActiveSnippetSlot());
        assertEquals(SqlCompletionSnippetSlotTypeEnum.INSERT_COLUMN_LIST.name(),
                request.getActiveSnippetSlot().type(),
                "the slot type is normalized to the enum name the parser expects");
        assertEquals(Integer.valueOf(14), request.getActiveSnippetSlot().replaceStart());

        assertEquals(2, request.getScopes().size());
        assertEquals(Long.valueOf(7L), request.getScopes().get(0).dataSourceId());
        assertEquals("app", request.getScopes().get(0).databaseName());
        assertEquals("s1", request.getScopes().get(0).schemaName());
        assertEquals(Long.valueOf(1L), request.getScopes().get(1).dataSourceId());
        assertNull(request.getScopes().get(1).databaseName(),
                "a scope without a database covers every database of its datasource");
        assertNull(request.getScopes().get(1).schemaName());
    }
}
