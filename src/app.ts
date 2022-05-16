import { sparqlRequest, wdApiRequest } from './api';
import { setBaseRevId } from './wikidata';
import {
	canExportValue,
	prepareCommonsMedia,
	prepareExternalId,
	prepareMonolingualText
} from './parser';
import { getI18n } from './i18n';
import { getConfig, getOrLoadProperty, getProperty, loadConfig, loadProperties, saveConfig, setConfig } from './config';
import { showDialog } from './ui';
import { loadMonths } from './months';
import { ApiResponse, SparqlResponse } from './types/api';
import { prepareQuantity } from './parser/quantity';
import { Statement } from './types/wikidata/main';
import { DataType, ItemId, PropertyId } from './types/wikidata/types';
import { prepareTime } from './parser/time';
import { Context, Property } from './types/main';
import { parseItem } from './parser/item';
import { prepareUrl } from './parser/url';
import { prepareString } from './parser/string';
import { prepareGlobeCoordinate } from './parser/coordinates';
import { guessPropertyIdByLabel, preloadAvailableProperties } from './property';

const $ = require( 'jquery' );
const mw = require( 'mw' );

const propertyIds: PropertyId[] = [ 'P2076', 'P2077' ]; // Temperature and pressure for qualifiers

/**
 * Parsing values from parameters before displaying a dialog
 */
async function parseField( $field: JQuery ): Promise<Statement[]> {
	const propertyId = $field.data( 'wikidata-property-id' );
	const property: Property | undefined = await getOrLoadProperty( propertyId );
	if ( typeof property === 'undefined' ) {
		mw.notify( getI18n( 'no-property-data' ).replace( '$1', propertyId ), {
			type: 'error',
			tag: 'wikidataInfoboxExport-error'
		} );
		return [];
	}

	const context: Context = {
		propertyId: propertyId,
		text: '',
		$field: $field.clone(),
		$wrapper: $field
	};

	context.$field.find( 'sup.reference' ).remove();
	context.$field.find( '.printonly' ).remove();
	context.$field.find( '[style*="display:none"]' ).remove();

	context.text = context.$field.text().trim();

	const $row: JQuery = $field.closest( 'tr' );
	if ( $row.length === 1 && $row.find( '[data-wikidata-property-id]' ).length === 1 ) {
		context.$wrapper = $row.clone();
	}

	switch ( property.datatype ) {
		case 'commonsMedia':
			return prepareCommonsMedia( context );

		case 'external-id':
			return prepareExternalId( context );

		case 'globe-coordinate':
			return prepareGlobeCoordinate( context );

		case 'monolingualtext':
			return prepareMonolingualText( context );

		case 'quantity':
			return prepareQuantity( context );

		case 'string':
			return prepareString( context );

		case 'time':
			return prepareTime( context );

		case 'wikibase-item':
			return parseItem( context );

		case 'url':
			return prepareUrl( context );
	}

	mw.notify( getI18n( 'unknown-datatype' ).replace( '$1', property.datatype ), {
		type: 'error',
		tag: 'wikidataInfoboxExport-error'
	} );

	return [];
}

/**
 * Double-click event on the infobox field
 */
async function clickEvent(): Promise<void> {
	const $field = $( this );
	if ( $field.hasClass( 'no-wikidata-loader' ) ||
		$field.parents( '.no-wikidata[data-wikidata-property-id]' ).length
	) {
		return;
	}
	$field.addClass( 'infobox-export-loader' );
	const statements: Statement[] = await parseField( $field );

	const subFields: JQuery[] = $field.find( '.no-wikidata[data-wikidata-property-id]' ).toArray();
	for ( const i in subFields ) {
		const $subField: JQuery = $( subFields[ i ] );
		const subStatements: Statement[] = await parseField( $subField );
		statements.push( ...subStatements );
	}

	await showDialog( statements );
	$field.removeClass( 'infobox-export-loader' );
}

async function loadDefaultReference(): Promise<void> {
	if ( getConfig( 'references.P143' ) !== undefined && getConfig( 'references.P4656' ) !== undefined ) {
		return;
	}

	const sparql: string = `SELECT ?wiki WHERE { ?wiki wdt:P31/wdt:P279* wd:Q33120876 . ?wiki wdt:P856 ?site . FILTER REGEX(STR(?site), "https://${location.host}/") }`;
	const data: SparqlResponse = await sparqlRequest( sparql );
	if ( !data?.results?.bindings?.length ) {
		return;
	}

	// Add current wiki project as "imported from Wikimedia project"
	const projectId: ItemId = data.results.bindings[ 0 ].wiki.value.replace( 'http://www.wikidata.org/entity/', '' ) as ItemId;
	setConfig( 'references.P143', [ {
		property: 'P143',
		snaktype: 'value',
		datavalue: {
			type: 'wikibase-entityid',
			value: { id: projectId }
		}
	} ] );

	// Add a link to the current version of the page as "Wikimedia import URL"
	setConfig( 'references.P4656', [ {
		property: 'P4656',
		datatype: 'url',
		snaktype: 'value',
		datavalue: {
			type: 'string',
			value: 'https://' + location.host + '/?oldid=' + mw.config.get( 'wgRevisionId' )
		}
	} ] );

	saveConfig();
}

/**
 * Initializing the gadget
 */
export async function init(): Promise<any> {
	const itemId: ItemId | null = mw.config.get( 'wgWikibaseItemId' );
	if ( itemId === null ||
		mw.config.get( 'wgAction' ) !== 'view' ||
		mw.util.getParamValue( 'veaction' ) !== null ||
		// @ts-ignore
		( window.ve && window.ve.init ) ||
		mw.config.get( 'wgNamespaceNumber' )
	) {
		return;
	}

	const preloaderCss = require( './assets/preloader.css' ).toString();
	mw.util.addCSS( preloaderCss );

	const $infobox: JQuery = $( '.infobox, .sinottico, table.toccolours, table.vcard, table.vevent, #mw-parser-output > table:first-child' );
	$infobox.addClass( 'infobox-export' );

	const $mainHeader: JQuery = $infobox.find( 'caption, th[colspan], td[colspan]' ).eq( 0 );
	$mainHeader.addClass( 'infobox-export-preloader' );
	const mainHeaderRowBackground: string | undefined = $mainHeader.parent( 'tr' ).css( 'background-color' );
	if ( $mainHeader.css( 'background-color' ) === 'rgba(0, 0, 0, 0)' &&
		( mainHeaderRowBackground === undefined || mainHeaderRowBackground === 'rgba(0, 0, 0, 0)' )
	) {
		$mainHeader.addClass( 'infobox-export-preloader-dark' );
	}

	// Item data request
	const data: ApiResponse = await wdApiRequest( {
		action: 'wbgetentities',
		props: [ 'info', 'claims' ],
		ids: mw.config.get( 'wgWikibaseItemId' )
	} );
	if ( !data.success ) {
		$mainHeader.removeClass( 'infobox-export-preloader' );
		return;
	}
	let claims: { [ key: string ]: Statement[] };
	for ( const i in data.entities ) {
		// @ts-ignore
		if ( i == -1 ) {
			$mainHeader.removeClass( 'infobox-export-preloader' );
			return;
		}

		claims = data.entities[ i ].claims;
		setBaseRevId( data.entities[ i ].lastrevid );
		break;
	}
	if ( !claims ) {
		$mainHeader.removeClass( 'infobox-export-preloader' );
		return;
	}

	loadConfig();
	await loadDefaultReference();
	await loadMonths();

	let $fields = $( '.infobox-export:not(.vertical-navbox):not([data-from]) .no-wikidata' );
	if ( !$fields.length ) {
		$( '.infobox-export' ).find( 'tr > th + td, tr > td + td' ).each( function () {
			const $label: JQuery = $( this ).prev();
			$label.addClass( 'infobox-export-label' );
		} );
		$fields = $( '.infobox-export:not(.vertical-navbox):not([data-from]) .infobox-export-label + td' );
		await preloadAvailableProperties( itemId );
	}
	$fields.each( async function () {
		const $field: JQuery = $( this );
		const propertyId: PropertyId | undefined = $field.attr( 'data-wikidata-property-id' ) as ( PropertyId | undefined );
		if ( typeof propertyId === 'undefined' ) {
			const $label: JQuery = $field.parent().children( 'th, .infobox-export-label' ).first();
			const guessedPropertyIds: PropertyId[] = await guessPropertyIdByLabel( $label, itemId );
			let guessedProperties: Property[] = await Promise.all( guessedPropertyIds.map(
				async ( propertyId: PropertyId ) => await getProperty( propertyId )
			) );

			// If at least one of these properties with same name and datatype already filled,
			// then we think that it is the correct one.
			const alreadyFilledDataTypes: DataType[] = [];
			for ( const guessedProperty of guessedProperties ) {
				if ( claims[ guessedProperty.id ] && claims[ guessedProperty.id ].length ) {
					alreadyFilledDataTypes.push( guessedProperty.datatype );
				}
			}

			guessedProperties = guessedProperties.filter(
				( property: Property ) => !alreadyFilledDataTypes.includes( property.datatype )
			);
			if ( !guessedProperties.length ) {
				return;
			}

			for ( const guessedProperty of guessedProperties ) {
				if ( alreadyFilledDataTypes.includes( guessedProperty.datatype ) ) {
					continue;
				}
				const canExport: boolean = await canExportValue( guessedProperty.id, $field, claims[ guessedProperty.id ] );
				if ( canExport ) {
					if ( !$field.attr( 'data-wikidata-property-id' ) ) {
						$field.attr( 'data-wikidata-property-id', guessedProperty.id );
						continue;
					}

					const $wrapper: JQuery = $( '<span>' )
						.addClass( 'no-wikidata' )
						.attr( 'data-wikidata-property-id', guessedProperty.id );
					$field.contents().wrapAll( $wrapper );
					propertyIds.push( guessedProperty.id );
					if ( claims[ guessedProperty.id ] && claims[ guessedProperty.id ].length ) {
						$wrapper.addClass( 'partial-wikidata' );
					}
					$wrapper.on( 'dblclick', clickEvent );
				}
			}
		}

		$field
			.removeClass( 'no-wikidata' )
			.off( 'dblclick' );
		propertyIds.push( propertyId );
		const canExport: boolean = await canExportValue( propertyId, $field, claims[ propertyId ] );
		if ( canExport ) {
			$field.addClass( 'no-wikidata' );
			if ( claims[ propertyId ] && claims[ propertyId ].length ) {
				$field.addClass( 'partial-wikidata' );
			}
			$field.on( 'dblclick', clickEvent );
		}

		const $fieldQualifiers = $field.closest( 'tr' ).find( '[data-wikidata-qualifier-id]' );
		$fieldQualifiers.each( function () {
			propertyIds.push( $( this ).data( 'wikidata-qualifier-id' ) );
		} );
	} );
	const mainCss = require( './assets/main.css' ).toString();
	mw.util.addCSS( mainCss );

	// TODO: Do not load properties until the window is opened for the first time
	await loadProperties( propertyIds );

	$mainHeader.removeClass( 'infobox-export-preloader' );
}
