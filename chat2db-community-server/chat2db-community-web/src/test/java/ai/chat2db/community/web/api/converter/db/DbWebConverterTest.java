package ai.chat2db.community.web.api.converter.db;

import ai.chat2db.community.domain.api.model.completion.SqlCompletionScope;
import ai.chat2db.community.domain.api.model.request.sql.DbSqlUnboundCompletionRequest;
import ai.chat2db.community.domain.api.model.result.ExecuteResponse;
import ai.chat2db.community.domain.api.model.result.ResultCell;
import ai.chat2db.community.web.api.model.request.db.UnboundSqlCompletionRequest;
import ai.chat2db.community.web.api.model.response.db.ExecuteResultResponse;
import org.junit.jupiter.api.Test;
import org.mapstruct.factory.Mappers;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class DbWebConverterTest {

    private final DbWebConverter converter = Mappers.getMapper(DbWebConverter.class);

    @Test
    void completionResponseOmitsRowsAndPreservesFinalPagingState() {
        ExecuteResponse result = ExecuteResponse.builder()
                .success(Boolean.TRUE)
                .dataList(List.of(
                        List.of(ResultCell.of("1")),
                        List.of(ResultCell.of("2"))))
                .pageNo(1)
                .pageSize(50_000)
                .fuzzyTotal("50000+")
                .hasNextPage(Boolean.TRUE)
                .resultSetId(1)
                .build();

        ExecuteResultResponse response = converter.dto2completionResponse(result);

        assertNull(response.getDataList());
        assertEquals(2, result.getDataList().size());
        assertEquals(50_000, response.getPageSize());
        assertEquals("50000+", response.getFuzzyTotal());
        assertEquals(Boolean.TRUE, response.getHasNextPage());
        assertEquals(1, response.getResultSetId());
    }

    @Test
    void unboundCompletionRequestIsRejectedWhenMissing() {
        assertNull(converter.request2UnboundCompletionParam(null));
    }

    @Test
    void unboundCompletionRequestKeepsTheSqlAndCursorItWasGiven() {
        UnboundSqlCompletionRequest request = new UnboundSqlCompletionRequest();
        request.setConsoleId(42L);
        request.setSql("select * from ord");
        request.setCursor(17);
        request.setBeforeSql("select * from ord");
        request.setAfterSql(";");
        request.setNeedFullName(Boolean.TRUE);
        request.setKeywordCase("upper");
        request.setScopes(List.of(SqlCompletionScope.of(7L, null, null), SqlCompletionScope.of(1L, "app", null)));

        DbSqlUnboundCompletionRequest param = converter.request2UnboundCompletionParam(request);

        assertEquals(Long.valueOf(42L), param.getConsoleId());
        assertEquals("select * from ord", param.getSql());
        assertEquals(17, param.getCursor().intValue());
        assertEquals(Boolean.TRUE, param.getNeedFullName());
        assertEquals("upper", param.getKeywordCase());
        assertEquals(
                List.of(SqlCompletionScope.of(7L, null, null), SqlCompletionScope.of(1L, "app", null)),
                param.getScopes());
    }

    @Test
    void unboundCompletionRequestFallsBackToTheSqlHalves() {
        UnboundSqlCompletionRequest request = new UnboundSqlCompletionRequest();
        request.setBeforeSql("select * from ");
        request.setAfterSql("ord");

        DbSqlUnboundCompletionRequest param = converter.request2UnboundCompletionParam(request);

        assertEquals("select * from ord", param.getSql());
        assertEquals(request.getBeforeSql().length(), param.getCursor().intValue());
    }
}
