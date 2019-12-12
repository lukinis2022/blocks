/** @module @airtable/blocks/models: RecordQueryResult */ /** */
import Colors, {Color} from '../colors';
import {BaseData} from '../types/base';
import {RecordId} from '../types/record';
import {FieldTypes, FieldId} from '../types/field';
import {
    isEnumValue,
    assertEnumValue,
    getLocallyUniqueId,
    isDeepEqual,
    ObjectValues,
    ObjectMap,
    cast,
    FlowAnyFunction,
    FlowAnyObject,
} from '../private_utils';
import {
    spawnAbstractMethodError,
    spawnUnknownSwitchCaseError,
    spawnError,
    spawnInvariantViolationError,
} from '../error_utils';
import Watchable from '../watchable';
import AbstractModelWithAsyncData from './abstract_model_with_async_data';
import Table from './table';
import Field from './field';
import Record from './record';
import RecordStore from './record_store';
import {
    ModeTypes as RecordColorModeTypes,
    modes as recordColorModes,
    RecordColorMode,
} from './record_coloring';

const WatchableRecordQueryResultKeys = Object.freeze({
    records: 'records' as const,
    recordIds: 'recordIds' as const,
    cellValues: 'cellValues' as const,
    recordColors: 'recordColors' as const,
    isDataLoaded: 'isDataLoaded' as const,
});
const WatchableCellValuesInFieldKeyPrefix = 'cellValuesInField:';

/**
 * A key in {@link RecordQueryResult} that can be watched
 * - `records`
 * - `recordIds`
 * - `cellValues`
 * - `recordColors`
 * - `isDataLoaded`
 * - `cellValuesInField:{FIELD_ID}`
 */
export type WatchableRecordQueryResultKey =
    | ObjectValues<typeof WatchableRecordQueryResultKeys>
    | string;

/** */
interface SortConfig {
    /** A field, field id, or field name. */
    field: Field | FieldId | string;
    /** The order to sort in. Defaults to asc. */
    direction?: 'asc' | 'desc';
}

/** @hidden */
export interface NormalizedSortConfig {
    fieldId: string;
    direction: 'asc' | 'desc';
}

/** */
export interface RecordQueryResultOpts {
    /** The order in which to sort the query result */
    sorts?: Array<SortConfig>;
    /** The fields (or field names or field ids) to load. Falsey values will be removed. */
    fields?: Array<Field | string | void | null | false>;
    /** How records in this QueryResult should be colored. */
    recordColorMode?: null | RecordColorMode;
}

/** @hidden */
export interface NormalizedRecordQueryResultOpts {
    sorts: Array<NormalizedSortConfig> | null;
    fieldIdsOrNullIfAllFields: Array<string> | null;
    recordColorMode: RecordColorMode;
    table: Table;
    recordStore: RecordStore;
}

/**
 * A RecordQueryResult represents a set of records. It's a little bit like a one-off View in Airtable: it
 * contains a bunch of records, filtered to a useful subset of the records in the table. Those
 * records can be sorted according to your specification, and they can be colored by a select field
 * or using the color from a view. Just like a view, you can either have all the fields in a table
 * available, or you can just ask for the fields that are relevant to you. There are two types of
 * QueryResult:
 *
 * - {@link TableOrViewQueryResult} is the most common, and is a query result filtered to all the
 *   records in a specific {@link Table} or {@link View}. You can get one of these with
 *   `table.selectRecords()` or `view.selectRecords()`.
 * - {@link LinkedRecordsQueryResult} is a query result of all the records in a particular
 *   {@link https://support.airtable.com/hc/en-us/articles/206452848-Linked-record-fields linked record cell}.
 *   You can get one of these with `record.selectLinkedRecordsFromCell(someField)`.
 *
 * Once you've got a query result, you need to load it before you can start working with it. When
 * you're finished, unload it:
 * ```js
 * async function fetchRecordsAndDoSomethingAsync(myTable) {
 *     // query for all the records in "myTable"
 *     const queryResult = myTable.selectRecords();
 *
 *     // load the data in the query result:
 *     await queryResult.loadDataAsync();
 *
 *     // work with the data in the query result
 *     doSomething(queryResult);
 *
 *     // when you're done, unload the data:
 *     queryResult.unloadData();
 * }
 * ```
 *
 * If you're using a query result in a React component, you don't need to worry about this. Just
 * use {@link useRecords}, {@link useRecordIds}, {@link useRecordById} or {@link useLoadable},
 * which will handle all that for you.
 *
 * Whilst loaded, a query result will automatically keep up to date with what's in Airtable:
 * records will get added or removed, the order will change, cell values will be updated, etc.
 * Again, if you're writing a React component then our hooks will look after that for you. If not,
 * you can get notified of these changes with `.watch()`.
 *
 * When calling a `.select*` method, you can pass in a number of options:
 *
 * ## sorts
 * Pass an array of sorts to control the order of records within the query result. The first sort
 * in the array has the highest priority. If you don't specify sorts, the query result will use the
 * inherent order of the source model: the same order you'd see in the main UI for views and linked
 * record fields, and an arbitrary (but stable) order for tables.
 *
 * ```js
 * view.selectRecords({
 *     sorts: [
 *         // sort by someField in ascending order...
 *         {field: someField},
 *         // then by someOtherField in descending order
 *         {field: someOtherField, direction: 'desc'},
 *     ]
 * });
 * ```
 *
 * ## fields
 * Generally, it's a good idea to load as little data into your block as possible - Airtable bases
 * can get pretty big, and we have to keep all that information in memory and up to date if you ask
 * for it. The fields option lets you make sure that only data relevant to you is loaded.
 *
 * You can specify fields with a {@link Field}, by ID, or by name:
 * ```js
 * view.selectRecords({
 *     fields: [
 *         // we want to only load fieldA:
 *         fieldA,
 *         // the field with this id:
 *         'fldXXXXXXXXXXXXXX',
 *         // and the field named 'Rating':
 *         'Rating',
 *     ],
 * });
 * ```
 *
 * ## recordColorMode
 * Just like a view in Airtable, you can control the colors of records in a field. There are three
 * supported record color modes:
 *
 * By taking the colors the records have according to the rules of a specific view:
 * ```js
 * import {recordColoring} from '@airtable/blocks/models';
 
 * someTable.selectRecords({
 *     recordColorMode: recordColoring.modes.byView(someView),
 * });
 * ```
 *
 * Based on the color of a single select field in the table:
 * ```js
 * import {recordColoring} from '@airtable/blocks/models';
 *
 * someView.selectRecords({
 *     recordColorMode: recordColoring.modes.bySelectField(someSelectField),
 * });
 * ```
 * 
 * By default, views will have whichever coloring is set up in Airtable and tables won't have any
 * record coloring:
 * 
 * ```js
 * // these two are the same:
 * someView.selectRecords();
 * someView.selectRecords({
 *     recordColorMode: recordColoring.modes.byView(someView),
 * });
 * 
 * // as are these two:
 * someTable.selectRecords();
 * someTable.selectRecords({
 *     recordColorMode: recordColoring.modes.none(),
 * });
 * ```
 * 
 * @docsPath models/Query results/RecordQueryResult
 */
class RecordQueryResult<DataType = {}> extends AbstractModelWithAsyncData<
    DataType,
    WatchableRecordQueryResultKey
> {
    /** @internal */
    static _className = 'RecordQueryResult';

    /**
     * The record IDs in this QueryResult.
     * Throws if data is not loaded yet.
     * Can be watched.
     */
    get recordIds(): Array<RecordId> {
        throw spawnAbstractMethodError();
    }
    /**
     * The set of record IDs in this QueryResult.
     * Throws if data is not loaded yet.
     *
     * @internal
     */
    _getOrGenerateRecordIdsSet(): ObjectMap<RecordId, true | void> {
        throw spawnAbstractMethodError();
    }
    /**
     * The fields that were used to create this QueryResult.
     * Null if fields were not specified, which means the QueryResult
     * will load all fields in the table.
     */
    get fields(): Array<Field> | null {
        throw spawnAbstractMethodError();
    }

    /**
     * @internal (since we may not be able to return parent model instances in the immutable models world)
     * The table that records in this QueryResult are part of
     */
    get parentTable(): Table {
        throw spawnAbstractMethodError();
    }

    /** @internal */
    static WatchableKeys = WatchableRecordQueryResultKeys;
    /** @internal */
    static WatchableCellValuesInFieldKeyPrefix = WatchableCellValuesInFieldKeyPrefix;
    /** @internal */
    static _isWatchableKey(key: string): boolean {
        return (
            isEnumValue(WatchableRecordQueryResultKeys, key) ||
            key.startsWith(WatchableCellValuesInFieldKeyPrefix)
        );
    }
    /** @internal */
    static _shouldLoadDataForKey(key: WatchableRecordQueryResultKey): boolean {
        return (
            key === RecordQueryResult.WatchableKeys.records ||
            key === RecordQueryResult.WatchableKeys.recordIds ||
            key === RecordQueryResult.WatchableKeys.cellValues ||
            key === RecordQueryResult.WatchableKeys.recordColors ||
            key.startsWith(RecordQueryResult.WatchableCellValuesInFieldKeyPrefix)
        );
    }

    /** @internal */
    static _normalizeOpts(
        table: Table,
        recordStore: RecordStore,
        opts: RecordQueryResultOpts = {},
    ): NormalizedRecordQueryResultOpts {
        const sorts = !opts.sorts
            ? null
            : opts.sorts.map(sort => {
                  const field = table.__getFieldMatching(sort.field);
                  if (
                      sort.direction !== undefined &&
                      sort.direction !== 'asc' &&
                      sort.direction !== 'desc'
                  ) {
                      throw spawnError('Invalid sort direction: %s', sort.direction);
                  }
                  return {
                      fieldId: field.id,
                      direction: sort.direction || 'asc',
                  };
              });

        let fieldIdsOrNullIfAllFields = null;
        if (opts.fields) {
            if (!Array.isArray(opts.fields)) {
                throw spawnInvariantViolationError('Must specify an array of fields');
            }
            fieldIdsOrNullIfAllFields = [];
            for (const fieldOrFieldIdOrFieldName of opts.fields) {
                if (!fieldOrFieldIdOrFieldName) {
                    continue;
                }
                if (
                    typeof fieldOrFieldIdOrFieldName !== 'string' &&
                    !(fieldOrFieldIdOrFieldName instanceof Field)
                ) {
                    throw spawnError(
                        'Invalid value for field, expected a field, id, or name but got: %s',
                        fieldOrFieldIdOrFieldName,
                    );
                }
                const field = table.__getFieldMatching(fieldOrFieldIdOrFieldName);
                fieldIdsOrNullIfAllFields.push(field.id);
            }
        }

        const recordColorMode = opts.recordColorMode || recordColorModes.none();
        switch (recordColorMode.type) {
            case RecordColorModeTypes.NONE:
                break;
            case RecordColorModeTypes.BY_SELECT_FIELD:
                if (!(recordColorMode.selectField.type === FieldTypes.SINGLE_SELECT)) {
                    throw spawnInvariantViolationError(
                        'Invalid field for coloring records by select field: expected a %s, but got a %s',
                        FieldTypes.SINGLE_SELECT,
                        recordColorMode.selectField.type,
                    );
                }
                if (!(recordColorMode.selectField.parentTable === table)) {
                    throw spawnInvariantViolationError(
                        'Invalid field for coloring records by select field: the single select field is not in the same table as the records',
                    );
                }
                if (fieldIdsOrNullIfAllFields) {
                    fieldIdsOrNullIfAllFields.push(recordColorMode.selectField.id);
                }
                break;
            case RecordColorModeTypes.BY_VIEW:
                if (!(recordColorMode.view.parentTable === table)) {
                    throw spawnInvariantViolationError(
                        'Invalid view for coloring records from view: the view is not in the same table as the records',
                    );
                }
                break;
            default:
                throw spawnError('Unknown record coloring mode: %s', cast<never>(recordColorMode));
        }

        if (!(table.id === recordStore.tableId)) {
            throw spawnInvariantViolationError('record store and table must match');
        }

        return {
            sorts,
            fieldIdsOrNullIfAllFields,
            recordColorMode,
            table,
            recordStore,
        };
    }

    /** @internal */
    _normalizedOpts: NormalizedRecordQueryResultOpts;
    /** @internal */
    _recordStore: RecordStore;
    /** @internal */
    _recordColorChangeHandler: FlowAnyFunction | null = null;

    /**
     * @internal
     */
    constructor(normalizedOpts: NormalizedRecordQueryResultOpts, baseData: BaseData) {
        super(baseData, getLocallyUniqueId('RecordQueryResult'));
        this._normalizedOpts = normalizedOpts;
        this._recordStore = normalizedOpts.recordStore;
    }

    /**
     * @internal
     */
    __canBeReusedForNormalizedOpts(normalizedOpts: NormalizedRecordQueryResultOpts): boolean {
        return isDeepEqual(this._normalizedOpts, normalizedOpts);
    }

    /**
     * The records in this RecordQueryResult.
     * Throws if data is not loaded yet.
     * Can be watched.
     */
    get records(): Array<Record> {
        return this.recordIds.map(recordId => {
            const record = this._recordStore.getRecordByIdIfExists(recordId);
            if (!record) {
                throw spawnInvariantViolationError('Record missing in table');
            }
            return record;
        });
    }

    /**
     * Get a specific record in the query result, or null if that record doesn't exist or is
     * filtered out. Throws if data is not loaded yet. Watch using `'recordIds'`.
     *
     * @param recordId the ID of the {@link Record} you want
     * @returns the record
     */
    getRecordByIdIfExists(recordId: RecordId): Record | null {
        const record = this._recordStore.getRecordByIdIfExists(recordId);
        if (!record || !this.hasRecord(record)) {
            return null;
        }

        return record;
    }

    /**
     * Get a specific record in the query result, or throws if that record doesn't exist or is
     * filtered out. Throws if data is not loaded yet. Watch using `'recordIds'`.
     *
     * @param recordId the ID of the {@link Record} you want
     * @returns the record
     */
    getRecordById(recordId: RecordId): Record {
        const record = this.getRecordByIdIfExists(recordId);
        if (!record) {
            throw spawnError('No record with ID %s in this query result', recordId);
        }
        return record;
    }

    /**
     * @internal
     */
    _getRecord(recordOrRecordId: RecordId | Record): Record {
        return this.getRecordById(
            typeof recordOrRecordId === 'string' ? recordOrRecordId : recordOrRecordId.id,
        );
    }

    /**
     * Check to see if a particular record or record id is present in this query result. Returns
     * false if the record has been deleted or is filtered out.
     *
     * @param recordOrRecordId the record or record id to check the presence of
     * @returns whether the record exists in this query result
     */
    hasRecord(recordOrRecordId: RecordId | Record): boolean {
        const recordId =
            typeof recordOrRecordId === 'string' ? recordOrRecordId : recordOrRecordId.id;
        return this._getOrGenerateRecordIdsSet()[recordId] === true;
    }

    /**
     * Get the color of a specific record in the query result. Throws if the record isn't in the
     * RecordQueryResult. Watch with the `'recordColors'` and `'recordIds` keys.
     *
     * @param recordOrRecordId the record or record ID you want the color of.
     * @returns a {@link Color}, or null if the record has no color in this query result.
     */
    getRecordColor(recordOrRecordId: RecordId | Record): Color | null {
        const record = this._getRecord(recordOrRecordId);
        const recordColorMode = this._normalizedOpts.recordColorMode;

        switch (recordColorMode.type) {
            case RecordColorModeTypes.NONE:
                return null;
            case RecordColorModeTypes.BY_SELECT_FIELD: {
                if (recordColorMode.selectField.type !== FieldTypes.SINGLE_SELECT) {
                    return null;
                }
                const value = record.getCellValue(recordColorMode.selectField);
                return value &&
                    typeof value === 'object' &&
                    typeof (value as any).color === 'string'
                    ? assertEnumValue(Colors, (value as any).color)
                    : null;
            }
            case RecordColorModeTypes.BY_VIEW:
                return this._recordStore
                    .getViewDataStore(recordColorMode.view.id)
                    .getRecordColor(record);
            default:
                throw spawnError('Unknown record coloring mode: %s', cast<never>(recordColorMode));
        }
    }

    /**
     * @internal
     */
    _onChangeIsDataLoaded() {
        this._onChange(WatchableRecordQueryResultKeys.isDataLoaded);
    }

    /**
     * Get notified of changes to the query result.
     *
     * Watchable keys are:
     * - `'records'`
     * - `'recordIds'`
     * - `'cellValues'`
     * - `'recordColors'`
     * - `'isDataLoaded'`
     * - `'cellValuesInField:' + someFieldId`
     *
     * Every call to `.watch` should have a matching call to `.unwatch`.
     *
     * Watching a key that needs to load data asynchronously will automatically
     * cause the data to be fetched. Once the data is available, the `callback`
     * will be called.
     *
     * @param keys the keys to watch
     * @param callback a function to call when those keys change
     * @param context an optional context for `this` in `callback`.
     * @returns the array of keys that were watched
     */
    watch(
        keys: WatchableRecordQueryResultKey | ReadonlyArray<WatchableRecordQueryResultKey>,
        callback: FlowAnyFunction,
        context?: FlowAnyObject | null,
    ): Array<WatchableRecordQueryResultKey> {
        const validKeys = super.watch(keys, callback, context);
        for (const key of validKeys) {
            if (key === WatchableRecordQueryResultKeys.recordColors) {
                this._watchRecordColorsIfNeeded();
            }
        }
        return validKeys;
    }

    /**
     * Unwatch keys watched with `.watch`.
     *
     * Should be called with the same arguments given to `.watch`.
     *
     * Unwatching a key that needs to load data asynchronously will automatically
     * cause the data to be unloaded.
     *
     * @param keys the keys to unwatch
     * @param callback the function passed to `.watch` for these keys
     * @param context the context that was passed to `.watch` for this `callback`
     * @returns the array of keys that were unwatched
     */
    unwatch(
        keys: WatchableRecordQueryResultKey | ReadonlyArray<WatchableRecordQueryResultKey>,
        callback: FlowAnyFunction,
        context?: FlowAnyObject | null,
    ): Array<WatchableRecordQueryResultKey> {
        const validKeys = super.unwatch(keys, callback, context);
        for (const key of validKeys) {
            if (key === WatchableRecordQueryResultKeys.recordColors) {
                this._unwatchRecordColorsIfPossible();
            }
        }
        return validKeys;
    }

    /**
     * @internal
     */
    _watchRecordColorsIfNeeded() {
        const watchCount = (
            this._changeWatchersByKey[WatchableRecordQueryResultKeys.recordColors] || []
        ).length;
        if (!this._recordColorChangeHandler && watchCount >= 1) {
            this._watchRecordColors();
        }
    }

    /**
     * @internal
     */
    _watchRecordColors() {
        const recordColorMode = this._normalizedOpts.recordColorMode;
        const handler = (model: Watchable<any>, key: string, recordIds?: Array<RecordId>) => {
            if (model === this) {
                this._onChange(WatchableRecordQueryResultKeys.recordColors, recordIds);
            } else {
                this._onChange(WatchableRecordQueryResultKeys.recordColors);
            }
        };

        switch (recordColorMode.type) {
            case RecordColorModeTypes.NONE:
                break;
            case RecordColorModeTypes.BY_SELECT_FIELD:
                this.watch(
                    `${WatchableCellValuesInFieldKeyPrefix}${recordColorMode.selectField.id}`,
                    handler,
                );
                recordColorMode.selectField.watch('options', handler);
                break;
            case RecordColorModeTypes.BY_VIEW: {
                this._recordStore
                    .getViewDataStore(recordColorMode.view.id)
                    .watch('recordColors', handler);
                break;
            }
            default:
                throw spawnError('Unknown record coloring type %s', cast<never>(recordColorMode));
        }

        this._recordColorChangeHandler = handler;
    }

    /**
     * @internal
     */
    _unwatchRecordColorsIfPossible() {
        const watchCount = (
            this._changeWatchersByKey[WatchableRecordQueryResultKeys.recordColors] || []
        ).length;
        if (this._recordColorChangeHandler && watchCount === 0) {
            this._unwatchRecordColors();
        }
    }

    /**
     * @internal
     */
    _unwatchRecordColors() {
        const recordColorMode = this._normalizedOpts.recordColorMode;
        const handler = this._recordColorChangeHandler;
        if (!handler) {
            throw spawnInvariantViolationError('record color change handler must exist');
        }

        switch (recordColorMode.type) {
            case RecordColorModeTypes.NONE:
                break;
            case RecordColorModeTypes.BY_SELECT_FIELD:
                this.unwatch(
                    `${WatchableCellValuesInFieldKeyPrefix}${recordColorMode.selectField.id}`,
                    handler,
                );
                recordColorMode.selectField.unwatch('options', handler);
                break;
            case RecordColorModeTypes.BY_VIEW: {
                this._recordStore
                    .getViewDataStore(recordColorMode.view.id)
                    .unwatch('recordColors', handler);
                break;
            }
            default:
                throw spawnError('unknown record coloring type %s', cast<never>(recordColorMode));
        }

        this._recordColorChangeHandler = null;
    }

    /**
     * @internal
     */
    async _loadRecordColorsAsync(): Promise<void> {
        const recordColorMode = this._normalizedOpts.recordColorMode;
        switch (recordColorMode.type) {
            case RecordColorModeTypes.NONE:
                return;
            case RecordColorModeTypes.BY_SELECT_FIELD:
                return;
            case RecordColorModeTypes.BY_VIEW:
                await this._recordStore.getViewDataStore(recordColorMode.view.id).loadDataAsync();
                return;
            default:
                throw spawnUnknownSwitchCaseError(
                    'record color mode type',
                    recordColorMode,
                    'type',
                );
        }
    }

    /**
     * @internal
     */
    _unloadRecordColors() {
        const recordColorMode = this._normalizedOpts.recordColorMode;
        switch (recordColorMode.type) {
            case RecordColorModeTypes.NONE:
                return;
            case RecordColorModeTypes.BY_SELECT_FIELD:
                return;
            case RecordColorModeTypes.BY_VIEW:
                this._recordStore.getViewDataStore(recordColorMode.view.id).unloadData();
                break;
            default:
                throw spawnUnknownSwitchCaseError(
                    'record color mode type',
                    recordColorMode,
                    'type',
                );
        }
    }
}

export default RecordQueryResult;
