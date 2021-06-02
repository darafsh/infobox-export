import { KeyValue } from './main';

export type ApiResponse = KeyValue
export type SparqlResponse = KeyValue

export interface MediaWikiApi {
	get: ( params: KeyValue ) => Promise<ApiResponse>;
	getMessages: ( messageKeys: string[], params: KeyValue ) => Promise<ApiResponse>;
	postWithToken: ( token: string, params: KeyValue ) => any;
}