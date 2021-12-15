import {
    BlockAPI as BlockAPIInterface,
    BlockTool as IBlockTool,
    BlockToolData,
    BlockTune as IBlockTune,
    SanitizerConfig,
    ToolConfig
  } from '../../../types';
  
  import { SavedData } from '../../../types/data-formats';
  import $ from '../dom';
  import * as _ from '../utils';
  import ApiModules from '../modules/api';
  import BlockAPI from './api';
  import SelectionUtils from '../selection';
  import BlockTool from './ref/block';
  
  import BlockTune from '../tools/tune';
  import { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
  import ToolsCollection from '../tools/collection';
  import EventsDispatcher from './ref/event';

interface BlockConstructorOptions {
    /**
     * Block's id. Should be passed for existed block, and omitted for a new one.
     */
    id?: string;
  
    /**
     * Initial Block data
     */
    data: BlockToolData;
  
    /**
     * Tool object
     */
    tool: BlockTool;
  
    /**
     * API methods
     */
    api: ApiModules;
  
    /**
     * This flag indicates that the Block should be constructed in the read-only mode.
     */
    readOnly: boolean;
  
    /**
     * Tunes data for current Block
     */
    tunesData: {[name: string]: BlockTuneData};
  }
  
  /**
   * @class Block
   * @classdesc This class describes editor`s block, including block`s HTMLElement, data and tool
   *
   * @property {BlockTool} tool — current block tool (Paragraph, for example)
   * @property {object} CSS — block`s css classes
   *
   */
  
  /**
   * Available Block Tool API methods
   */
  export enum BlockToolAPI {
    /**
     * @todo remove method in 3.0.0
     * @deprecated — use 'rendered' hook instead
     */
    APPEND_CALLBACK = 'appendCallback',
    RENDERED = 'rendered',
    MOVED = 'moved',
    UPDATED = 'updated',
    REMOVED = 'removed',
    ON_PASTE = 'onPaste',
  }
  
  /**
   * Names of events supported by Block class
   */
  type BlockEvents = 'didMutated';
  
  /**
   * @classdesc Abstract Block class that contains Block information, Tool name and Tool class instance
   *
   * @property {BlockTool} tool - Tool instance
   * @property {HTMLElement} holder - Div element that wraps block content with Tool's content. Has `ce-block` CSS class
   * @property {HTMLElement} pluginsContent - HTML content that returns by Tool's render function
   */


  export default class Block extends EventsDispatcher<BlockEvents> {
    /**
     * CSS classes for the Block
     *
     * @returns {{wrapper: string, content: string}}
     */
    public static get CSS(): {[name: string]: string} {
      return {
        wrapper: 'ce-block',
        wrapperStretched: 'ce-block--stretched',
        content: 'ce-block__content',
        focused: 'ce-block--focused',
        selected: 'ce-block--selected',
        dropTarget: 'ce-block--drop-target',
      };
    }
  
    /**
     * Block unique identifier
     */
    public id: string;
  
    /**
     * Block Tool`s name
     */
    public readonly name: string;
  
    /**
     * Instance of the Tool Block represents
     */
    public readonly tool: BlockTool;
  
    /**
     * User Tool configuration
     */
    public readonly settings: ToolConfig;
  
    /**
     * Wrapper for Block`s content
     */
    public readonly holder: HTMLDivElement;
  
    /**
     * Tunes used by Tool
     */
    public readonly tunes: ToolsCollection<BlockTune>;
  
    /**
     * Tool's user configuration
     */
    public readonly config: ToolConfig;
  
    /**
     * Cached inputs
     *
     * @type {HTMLElement[]}
     */
    private cachedInputs: HTMLElement[] = [];
  
    /**
     * Tool class instance
     */
    private readonly toolInstance: IBlockTool;
  
    /**
     * User provided Block Tunes instances
     */
    private readonly tunesInstances: Map<string, IBlockTune> = new Map();
  
    /**
     * Editor provided Block Tunes instances
     */
    private readonly defaultTunesInstances: Map<string, IBlockTune> = new Map();
  
    /**
     * If there is saved data for Tune which is not available at the moment,
     * we will store it here and provide back on save so data is not lost
     */
    private unavailableTunesData: {[name: string]: BlockTuneData} = {};
  
    /**
     * Editor`s API module
     */
    private readonly api: ApiModules;
  
    /**
     * Focused input index
     *
     * @type {number}
     */
    private inputIndex = 0;
  
    /**
     * Mutation observer to handle DOM mutations
     *
     * @type {MutationObserver}
     */
    private mutationObserver: MutationObserver;
  
    /**
     * Debounce Timer
     *
     * @type {number}
     */
    private readonly modificationDebounceTimer = 450;
  
    /**
     * Is fired when DOM mutation has been happened
     */
    private didMutated = _.debounce((mutations: MutationRecord[] = []): void => {
      const shouldFireUpdate = !mutations.some(({ addedNodes = [], removedNodes }) => {
        return [...Array.from(addedNodes), ...Array.from(removedNodes)]
          .some(node => $.isElement(node) && (node as HTMLElement).dataset.mutationFree === 'true');
      });
  
      /**
       * In case some mutation free elements are added or removed, do not trigger didMutated event
       */
      if (!shouldFireUpdate) {
        return;
      }
  
      /**
       * Drop cache
       */
      this.cachedInputs = [];
  
      /**
       * Update current input
       */
      this.updateCurrentInput();
  
      this.call(BlockToolAPI.UPDATED);
  
      this.emit('didMutated', this);
    }, this.modificationDebounceTimer);
  
    /**
     * Current block API interface
     */
    private readonly blockAPI: BlockAPIInterface;
  
    /**
     * @param {object} options - block constructor options
     * @param {string} [options.id] - block's id. Will be generated if omitted.
     * @param {BlockToolData} options.data - Tool's initial data
     * @param {BlockToolConstructable} options.tool — block's tool
     * @param options.api - Editor API module for pass it to the Block Tunes
     * @param {boolean} options.readOnly - Read-Only flag
     */
    constructor({
      id = _.generateBlockId(),
      data,
      tool,
      api,
      readOnly,
      tunesData,
    }: BlockConstructorOptions) {
      super();
  
      this.name = tool.name;
      this.id = id;
      this.settings = tool.settings;
      this.config = tool.settings.config || {};
      this.api = api;
      this.blockAPI = new BlockAPI(this);
  
      this.mutationObserver = new MutationObserver(this.didMutated);
  
      this.tool = tool;
      this.toolInstance = tool.create(data, this.blockAPI, readOnly);
  
      /**
       * @type {BlockTune[]}
       */
      this.tunes = tool.tunes;
  
      this.composeTunes(tunesData);
  
      this.holder = this.compose();
    }

    public call(methodName: string, params?: object): void {
        /**
         * call Tool's method with the instance context
         */
        if (_.isFunction(this.toolInstance[methodName])) {
          if (methodName === BlockToolAPI.APPEND_CALLBACK) {
            _.log(
              '`appendCallback` hook is deprecated and will be removed in the next major release. ' +
              'Use `rendered` hook instead',
              'warn'
            );
          }
    
          try {
            // eslint-disable-next-line no-useless-call
            this.toolInstance[methodName].call(this.toolInstance, params);
          } catch (e) {
            _.log(`Error during '${methodName}' call: ${e.message}`, 'error');
          }
        }
    }
}
  