import {
  SqlStatement,
  MarkMessage,
  SimpleIdentifier,
  ISimpleDatabaseVO,
  ISimpleSchemaVO,
  ISimpleTableVO,
  ISimpleViewVO,
  ISimpleFunctionVO,
  ISimpleProcedureVO,
  IHoverInfo,
  ISqlCompletionActiveSnippetSlot,
  SqlCompletionKeywordCase,
  ISqlCompletionResult,
  IExecutionDatasource,
} from '@/typings/sqlParser';
import createRequest from './base';

const prefix = '/api/sql_parser';

/**
 * Parse SQL statements
 */
const querySQLParser = createRequest<
  {
    consoleId: number;
    dataSourceId: number;
    databaseName?: string;
    schemaName?: string;
    sql: string;
  },
  {
    sqlStatementList: SqlStatement[];
    markMessageList: MarkMessage[];
  }
>(`${prefix}/context/parser`, {
  method: 'post',
  errorLevel: false,
});

const queryQuickSQLParser = createRequest<
  { consoleId: number; dataSourceId: number; databaseName?: string; schemaName?: string; sql: string },
  { sqlStatementList: SqlStatement[]; markMessageList: MarkMessage[] }
>(`${prefix}/context/quick_parser`, {
  method: 'post',
  errorLevel: false,
});

/**
 * Get database and schema
 */
const queryDatabaseAndSchema = createRequest<
  { consoleId: number; dataSourceId: number; databaseName?: string; schemaName?: string },
  {
    databases: ISimpleDatabaseVO[];
    schemas: ISimpleSchemaVO[];
    tables: ISimpleTableVO[];
    views: ISimpleViewVO[];
    functions: ISimpleFunctionVO[];
    procedures: ISimpleProcedureVO[];
  }
>(`${prefix}/get_keywords`, {
  errorLevel: false,
});

/**
 * Get tips
 */
const queryTips = createRequest<
  {
    consoleId: number;
    dataSourceId: number;
    databaseName?: string;
    schemaName?: string;

    /** Whether a fully qualified name is required */
    needFullName?: boolean;
    /** SQL keyword presentation case for backend-owned completion candidates */
    keywordCase?: SqlCompletionKeywordCase;
    /** Current Monaco snippet placeholder slot */
    activeSnippetSlot?: ISqlCompletionActiveSnippetSlot;
  } & (
    | {
        /** Complete SQL in the current editor */
        sql: string;
        /** The offset of the cursor in the complete SQL */
        cursor: number;
      }
    | {
        /** The previous part of the cursor in the current sql sql */
        beforeSql: string;
        /** The part of sql behind the cursor in the current sql */
        afterSql: string;
      }
  ),
  ISqlCompletionResult
>(`${prefix}/context/tip`, {
  method: 'post',
  errorLevel: false,
});

/**
 * Complete SQL against every datasource the editor may name a table from, whether
 * or not it is bound to one. Every scope listed is read with its own connection and
 * the candidates are merged server-side, so the order of `scopes` decides which
 * datasource wins a duplicated table or column name.
 */
const queryUnboundTips = createRequest<
  {
    consoleId: number;
    /** Datasources to collect candidates from, most relevant first. */
    scopes: Array<{ dataSourceId: number; databaseName?: string; schemaName?: string }>;

    /** Whether a fully qualified name is required */
    needFullName?: boolean;
    /** SQL keyword presentation case for backend-owned completion candidates */
    keywordCase?: SqlCompletionKeywordCase;
    /** Current Monaco snippet placeholder slot */
    activeSnippetSlot?: ISqlCompletionActiveSnippetSlot;
  } & (
    | {
        /** Complete SQL in the current editor */
        sql: string;
        /** The offset of the cursor in the complete SQL */
        cursor: number;
      }
    | {
        /** The previous part of the cursor in the current sql sql */
        beforeSql: string;
        /** The part of sql behind the cursor in the current sql */
        afterSql: string;
      }
  ),
  ISqlCompletionResult
>(`${prefix}/context/tip/unbound`, {
  method: 'post',
  errorLevel: false,
});

/**
 * Ask which datasource a statement has to be executed against, when the console's own binding is not
 * the one holding the tables it names. Only read-only statements are ever moved, and a result without
 * a datasource means the console keeps the statement.
 */
const queryExecutionDatasource = createRequest<
  {
    consoleId?: number;
    sql: string;
    /** Datasource the console is bound to. */
    dataSourceId?: number;
    /** Database the console is bound to. */
    databaseName?: string;
    /** Schema the console is bound to. */
    schemaName?: string;
    /** Datasources to try after the bound one, most relevant first. */
    scopes: Array<{ dataSourceId: number }>;
  },
  IExecutionDatasource
>(`${prefix}/context/execution_datasource`, {
  method: 'post',
  errorLevel: false,
});

const queryHover = createRequest<
  {
    consoleId: number;
    /** All sql in the current editor */
    sql: string;
    /** The complete status of the parsed SQL of the current cursor hover */
    currentStatement: SqlStatement;
    hoverIdentifier: SimpleIdentifier;
    dataSourceId: number;
    databaseName?: string;
    schemaName?: string;
  },
  Array<IHoverInfo>
>(`${prefix}/context/hover`, {
  method: 'post',
  errorLevel: false,
});

export default {
  querySQLParser,
  queryQuickSQLParser,
  queryDatabaseAndSchema,
  queryTips,
  queryUnboundTips,
  queryExecutionDatasource,
  queryHover,
};
