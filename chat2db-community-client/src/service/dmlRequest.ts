export interface IDataSourceExecutionContext {
  dataSourceId: number;
  databaseName?: string;
  schemaName?: string | null;
}

/** A datasource a console may reach besides its own binding, for routing and completion. */
export interface IExecutionScope {
  dataSourceId: number;
  databaseName?: string;
  schemaName?: string;
}

export interface ISqlEditorExecuteRequest extends IDataSourceExecutionContext {
  sql: string;
  consoleId?: number;
  applyId?: number;
  pageNo?: number;
  pageSize?: number;
  single?: boolean;
  resultSetId?: number;
  errorContinue?: boolean;
  explain?: boolean;
  /** Datasources to try when a statement names tables the bound datasource does not hold. */
  scopes?: IExecutionScope[];
}

export interface ITableBrowseRequest extends IDataSourceExecutionContext {
  tableName: string;
  pageNo?: number;
  pageSize?: number;
}

export interface ITableEditExecuteRequest extends IDataSourceExecutionContext {
  sql: string;
}

export interface IDdlExecuteRequest extends IDataSourceExecutionContext {
  sql: string;
  tableName?: string;
  errorContinue?: boolean;
}
