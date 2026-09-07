/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it} from 'node:test';

import {
  CssFormatter,
  resolveContainerQueries,
  type UidResolver,
} from '../../src/formatters/CssFormatter.js';
import {DevTools} from '../../src/third_party/index.js';
import type {MatchedStyles} from '../../src/tools/ToolDefinition.js';

type NodeStyle = DevTools.CSSStyleDeclaration.CSSStyleDeclaration;
type StyleProperty = DevTools.CSSProperty.CSSProperty;

describe('CssFormatter', () => {
  function createMockNode(
    selector = 'button',
    backendNodeId = 1,
  ): DevTools.DOMModel.DOMNode {
    return {
      id: 1,
      backendNodeId: () => backendNodeId,
      simpleSelector: () => selector,
      nodeNameInCorrectCase: () => selector.split(/[#.]/)[0] || selector,
    } as unknown as DevTools.DOMModel.DOMNode;
  }

  interface MockRuleOptions {
    sourceURL?: string;
    lineNumber?: number;
    columnNumber?: number;
    origin?: 'regular' | 'user-agent' | 'injected' | 'inspector';
    isConstructed?: boolean;
    nestingSelectors?: string[];
    selectors?: Array<{text: string}>;
    layers?: Array<{text?: string}>;
    media?: Array<{text: string}>;
    containerQueries?: Array<{
      text?: string;
      name?: string;
      getContainerForNode?: (nodeId: number) => Promise<unknown>;
    }>;
    scopes?: Array<{text: string}>;
    supports?: Array<{text: string}>;
    startingStyles?: unknown[];
    navigations?: Array<{text?: string}>;
    ruleTypes?: DevTools.Protocol.CSS.CSSRuleType[];
  }

  function synthesizeRuleTypes(
    options: MockRuleOptions,
  ): DevTools.Protocol.CSS.CSSRuleType[] | undefined {
    if (options.ruleTypes !== undefined) {
      return options.ruleTypes;
    }
    const ruleTypes: DevTools.Protocol.CSS.CSSRuleType[] = [];
    const mappings: Array<
      [unknown[] | undefined, DevTools.Protocol.CSS.CSSRuleType]
    > = [
      [options.navigations, DevTools.Protocol.CSS.CSSRuleType.NavigationRule],
      [options.nestingSelectors, DevTools.Protocol.CSS.CSSRuleType.StyleRule],
      [
        options.startingStyles,
        DevTools.Protocol.CSS.CSSRuleType.StartingStyleRule,
      ],
      [options.scopes, DevTools.Protocol.CSS.CSSRuleType.ScopeRule],
      [options.supports, DevTools.Protocol.CSS.CSSRuleType.SupportsRule],
      [
        options.containerQueries,
        DevTools.Protocol.CSS.CSSRuleType.ContainerRule,
      ],
      [options.media, DevTools.Protocol.CSS.CSSRuleType.MediaRule],
      [options.layers, DevTools.Protocol.CSS.CSSRuleType.LayerRule],
    ];
    for (const [items, ruleType] of mappings) {
      if (items) {
        for (const _ of items) {
          ruleTypes.push(ruleType);
        }
      }
    }
    return ruleTypes.length > 0 ? ruleTypes : undefined;
  }

  function createMockHeader(sourceURL?: string) {
    if (!sourceURL) {
      return null;
    }
    return {
      sourceURL,
      lineNumberInSource: (line: number) => line,
      columnNumberInSource: (_line: number, col: number) => col,
      isConstructedByNew: () => false,
    };
  }

  function attachRuleMeta(
    rule: object,
    sourceURL?: string,
    origin: 'regular' | 'user-agent' | 'injected' | 'inspector' = 'regular',
  ) {
    Object.defineProperty(rule, 'sourceURL', {
      value: sourceURL,
      writable: true,
      configurable: true,
    });
    return {
      origin,
      isUserAgent: () => origin === 'user-agent',
      isInjected: () => origin === 'injected',
      isViaInspector: () => origin === 'inspector',
      header: createMockHeader(sourceURL),
    };
  }

  function createMockRule(
    selector: string,
    options: MockRuleOptions = {},
  ): DevTools.CSSRule.CSSStyleRule {
    const mock = Object.create(DevTools.CSSRule.CSSStyleRule.prototype);
    const meta = attachRuleMeta(mock, options.sourceURL, options.origin);
    return Object.assign(mock, meta, {
      header:
        options.isConstructed !== undefined
          ? {isConstructedByNew: () => options.isConstructed}
          : meta.header,
      selectorText: () => selector,
      lineNumberInSource: () => options.lineNumber ?? 0,
      columnNumberInSource: () =>
        options.columnNumber !== undefined
          ? options.columnNumber
          : options.lineNumber !== undefined
            ? 0
            : undefined,
      selectors: options.selectors ?? [{text: selector}],
      nestingSelectors: options.nestingSelectors,
      layers: options.layers,
      media: options.media,
      containerQueries: options.containerQueries,
      scopes: options.scopes,
      supports: options.supports,
      startingStyles: options.startingStyles,
      navigations: options.navigations,
      ruleTypes: synthesizeRuleTypes(options),
    });
  }

  function createMockProperty(
    name: string,
    value: string,
    important = false,
    extra: {parsedOk?: boolean; disabled?: boolean} = {},
  ) {
    return {
      name,
      value,
      important,
      parsedOk: extra.parsedOk ?? true,
      disabled: extra.disabled ?? false,
    } as unknown as StyleProperty;
  }

  function createMockStyle(
    properties: StyleProperty[],
    rule?: unknown,
    type = DevTools.CSSStyleDeclaration.Type.Regular,
    animationName?: string,
  ): NodeStyle {
    return {
      type,
      allProperties: () => properties,
      leadingProperties: () => properties,
      parentRule: rule ?? null,
      animationName: () => animationName ?? '',
    } as unknown as NodeStyle;
  }

  function createMockInlineStyle(properties: StyleProperty[]): NodeStyle {
    return createMockStyle(
      properties,
      undefined,
      DevTools.CSSStyleDeclaration.Type.Inline,
    );
  }

  function createMockAtRule(
    type: string,
    options: {
      name?: string;
      subsection?: string;
      properties: StyleProperty[];
      sourceURL?: string;
      origin?: 'regular' | 'user-agent' | 'injected' | 'inspector';
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    },
  ): DevTools.CSSRule.CSSAtRule {
    const mock = Object.create(DevTools.CSSRule.CSSAtRule.prototype);
    const meta = attachRuleMeta(mock, options.sourceURL, options.origin);
    const style = createMockStyle(options.properties, mock);
    Object.assign(style, {range: options.range});
    return Object.assign(mock, meta, {
      type: () => type,
      name: () => (options.name ? {text: options.name} : null),
      subsection: () => options.subsection ?? null,
      style,
    });
  }

  function createMockKeyframesRule(
    name: string,
    keyframes: Array<{
      key: string;
      properties: StyleProperty[];
      sourceURL?: string;
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>,
  ): DevTools.CSSRule.CSSKeyframesRule {
    const mock = Object.create(DevTools.CSSRule.CSSKeyframesRule.prototype);
    const mockKeyframes = keyframes.map(kf => {
      const kfMock = Object.create(DevTools.CSSRule.CSSKeyframeRule.prototype);
      const meta = attachRuleMeta(kfMock, kf.sourceURL);
      const style = createMockStyle(kf.properties, kfMock);
      Object.assign(style, {range: kf.range});
      return Object.assign(kfMock, meta, {
        key: () => ({text: kf.key}),
        style,
      });
    });

    return Object.assign(mock, {
      name: () => ({text: name}),
      keyframes: () => mockKeyframes,
    });
  }

  function createMockPositionTryRule(
    name: string,
    options: {
      active?: boolean;
      properties: StyleProperty[];
      sourceURL?: string;
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    },
  ): DevTools.CSSRule.CSSPositionTryRule {
    const mock = Object.create(DevTools.CSSRule.CSSPositionTryRule.prototype);
    const meta = attachRuleMeta(mock, options.sourceURL);
    const style = createMockStyle(options.properties, mock);
    Object.assign(style, {range: options.range});
    return Object.assign(mock, meta, {
      name: () => ({text: name}),
      active: () => options.active ?? false,
      style,
    });
  }

  function createMockRegisteredProperty(
    name: string,
    options: {
      syntax?: string;
      inherits?: boolean;
      initialValue?: string;
      sourceURL?: string;
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
      isProgrammatic?: boolean;
    } = {},
  ): DevTools.CSSMatchedStyles.CSSRegisteredProperty {
    const properties: StyleProperty[] = [
      createMockProperty('syntax', options.syntax ?? '"*"'),
      createMockProperty('inherits', String(options.inherits ?? false)),
    ];
    if (options.initialValue) {
      properties.push(
        createMockProperty('initial-value', options.initialValue),
      );
    }

    let parentRule: DevTools.CSSRule.CSSPropertyRule | null = null;
    if (!options.isProgrammatic) {
      const mockRule = Object.create(
        DevTools.CSSRule.CSSPropertyRule.prototype,
      );
      const meta = attachRuleMeta(mockRule, options.sourceURL);
      parentRule = Object.assign(mockRule, meta, {
        propertyName: () => ({text: name}),
      });
    }

    const style = createMockStyle(properties, parentRule);
    Object.assign(style, {range: options.range});
    if (parentRule) {
      Object.assign(parentRule, {style});
    }

    const mockProp = Object.create(
      DevTools.CSSMatchedStyles.CSSRegisteredProperty.prototype,
    );
    return Object.assign(mockProp, {
      propertyName: () => name,
      inherits: () => options.inherits ?? false,
      syntax: () => options.syntax ?? '"*"',
      initialValue: () => options.initialValue ?? null,
      style: () => style,
    });
  }

  function createMockFunctionRule(
    nameWithParams: string,
    options: {
      functionName?: string;
      properties: StyleProperty[];
      sourceURL?: string;
      range?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    },
  ): DevTools.CSSRule.CSSFunctionRule {
    const mock = Object.create(DevTools.CSSRule.CSSFunctionRule.prototype);
    const meta = attachRuleMeta(mock, options.sourceURL);
    const style = createMockStyle(options.properties, mock);
    Object.assign(style, {range: options.range});
    const baseName =
      options.functionName ?? nameWithParams.split('(')[0] ?? nameWithParams;
    return Object.assign(mock, meta, {
      functionName: () => ({text: baseName}),
      nameWithParameters: () => nameWithParams,
      style,
    });
  }

  interface MockMatchedStylesParams {
    node?: string | DevTools.DOMModel.DOMNode;
    nodeStyles?: NodeStyle[];
    inheritedStyles?: NodeStyle[];
    atRules?: DevTools.CSSRule.CSSAtRule[];
    keyframes?: DevTools.CSSRule.CSSKeyframesRule[];
    positionTryRules?: DevTools.CSSRule.CSSPositionTryRule[];
    registeredProperties?: DevTools.CSSMatchedStyles.CSSRegisteredProperty[];
    functionRules?: DevTools.CSSRule.CSSFunctionRule[];
    parentNode?: string | DevTools.DOMModel.DOMNode;
    nodeForStyleMap?: Map<NodeStyle, DevTools.DOMModel.DOMNode>;
    pseudoStyles?: Map<DevTools.Protocol.DOM.PseudoType, NodeStyle[]>;
    customHighlights?: Map<string, NodeStyle[]>;
    propertyStates?: Map<StyleProperty, string>;
    matchingSelectorsMap?: Map<unknown, number[]>;
    inheritedStylesSet?: Set<NodeStyle>;
  }

  function createMockMatchedStyles(
    params: MockMatchedStylesParams = {},
  ): MatchedStyles {
    const mockNode =
      typeof params.node === 'string'
        ? createMockNode(params.node)
        : (params.node ?? createMockNode());

    const inheritedStylesSet =
      params.inheritedStylesSet ?? new Set(params.inheritedStyles ?? []);
    const inheritedStyles = params.inheritedStyles ?? [];
    const nodeStyles = params.nodeStyles
      ? [...params.nodeStyles, ...inheritedStyles]
      : inheritedStyles;

    const defaultParentNode =
      typeof params.parentNode === 'string'
        ? createMockNode(params.parentNode)
        : params.parentNode;
    const nodeForStyleMap = params.nodeForStyleMap ?? new Map();

    const pseudoStylesMap = params.pseudoStyles ?? new Map();
    const pseudoTypes = new Set(pseudoStylesMap.keys());
    const customHighlights = params.customHighlights ?? new Map();
    const propertyStates = params.propertyStates ?? new Map();

    const mockMatchedStyles = {
      node: () => mockNode,
      nodeStyles: () => nodeStyles,
      inheritedStyles: () => inheritedStyles,
      atRules: () => params.atRules ?? [],
      keyframes: () => params.keyframes ?? [],
      positionTryRules: () => params.positionTryRules ?? [],
      registeredProperties: () => params.registeredProperties ?? [],
      functionRules: () => params.functionRules ?? [],
      nodeForStyle: (style: NodeStyle) =>
        nodeForStyleMap.get(style) ?? defaultParentNode ?? null,
      isInherited: (style: NodeStyle) => inheritedStylesSet.has(style),
      pseudoTypes: () => pseudoTypes,
      pseudoStyles: (type: DevTools.Protocol.DOM.PseudoType) =>
        pseudoStylesMap.get(type) ?? [],
      customHighlightPseudoNames: () => [...customHighlights.keys()],
      customHighlightPseudoStyles: (name: string) =>
        customHighlights.get(name) ?? [],
      propertyState: (prop: StyleProperty) =>
        propertyStates.get(prop) ?? 'Active',
      getMatchingSelectors: (rule: unknown) =>
        params.matchingSelectorsMap?.get(rule) ?? [],
    };

    return mockMatchedStyles as unknown as MatchedStyles;
  }

  function formatterTest(
    label: string,
    setup: (t: it.TestContext) => CssFormatter | Promise<CssFormatter>,
  ) {
    it(label + ' toString', async t => {
      const formatter = await setup(t);
      t.assert.snapshot(formatter.toString());
    });
    it(label + ' toJSON', async t => {
      const formatter = await setup(t);
      t.assert.snapshot(JSON.stringify(formatter.toJSON(), null, 2));
    });
  }

  formatterTest(
    'formats element label with id, class, and uid and no styles',
    () => {
      const matchedStyles = createMockMatchedStyles({node: 'div#main'});
      return new CssFormatter(matchedStyles, {uid: '1_1'});
    },
  );

  formatterTest(
    'formats inline styles with active and overloaded properties',
    () => {
      const prop1 = createMockProperty('color', 'red');
      const prop2 = createMockProperty('font-size', '14px', true);

      const matchedStyles = createMockMatchedStyles({
        nodeStyles: [createMockInlineStyle([prop1, prop2])],
        propertyStates: new Map([[prop1, 'Overloaded']]),
      });

      return new CssFormatter(matchedStyles, {uid: '1_2'});
    },
  );

  describe('rule subsets', () => {
    function createMatchedStylesForRuleSubsets() {
      return createMockMatchedStyles({
        nodeStyles: [
          createMockStyle(
            [createMockProperty('color', 'red')],
            createMockRule('.rule-1', {sourceURL: 'app.css', lineNumber: 10}),
          ),
          createMockStyle(
            [createMockProperty('color', 'blue')],
            createMockRule('.rule-2', {sourceURL: 'app.css', lineNumber: 20}),
          ),
          createMockStyle(
            [createMockProperty('color', 'green')],
            createMockRule('.rule-3', {sourceURL: 'app.css', lineNumber: 30}),
          ),
        ],
      });
    }

    formatterTest('matched rules all 3 rules', () => {
      return new CssFormatter(createMatchedStylesForRuleSubsets(), {
        uid: 'btn-1',
      });
    });

    formatterTest('matched rules subset - first 2 rules', () => {
      const matchedStyles = createMatchedStylesForRuleSubsets();
      const fullFormatter = new CssFormatter(matchedStyles, {uid: 'btn-1'});
      return new CssFormatter(
        matchedStyles,
        {uid: 'btn-1'},
        fullFormatter.rules.slice(0, 2),
      );
    });

    formatterTest('matched rules subset - last rule', () => {
      const matchedStyles = createMatchedStylesForRuleSubsets();
      const fullFormatter = new CssFormatter(matchedStyles, {uid: 'btn-1'});
      return new CssFormatter(
        matchedStyles,
        {uid: 'btn-1'},
        fullFormatter.rules.slice(2, 3),
      );
    });
  });

  formatterTest('formats data: and blob: stylesheet URLs correctly', () => {
    const matchedStyles = createMockMatchedStyles({
      nodeStyles: [
        createMockStyle(
          [createMockProperty('color', 'blue')],
          createMockRule('.data-rule', {
            sourceURL: 'data:text/css;base64,LmRhdGEte30=',
          }),
        ),
        createMockStyle(
          [createMockProperty('color', 'green')],
          createMockRule('.blob-rule', {
            sourceURL: 'blob:http://example.com/1234-5678-90ab',
          }),
        ),
      ],
    });

    return new CssFormatter(matchedStyles, {uid: 'data-elem'});
  });

  formatterTest('formats mixed inline and matched rules', () => {
    const matchedStyles = createMockMatchedStyles({
      node: 'button#btn-id',
      nodeStyles: [
        createMockInlineStyle([createMockProperty('color', 'red')]),
        createMockStyle(
          [createMockProperty('font-size', '16px')],
          createMockRule('.btn', {sourceURL: 'style.css', lineNumber: 5}),
        ),
      ],
    });

    return new CssFormatter(matchedStyles, {uid: '1_1'});
  });

  formatterTest(
    'formats inherited styles from ancestors and ignores non-inheritable ones',
    () => {
      const inhStyle = createMockStyle(
        [
          createMockProperty('color', 'black'),
          createMockProperty('margin', '20px'),
          createMockProperty('--custom-var', '10px'),
        ],
        createMockRule('.parent-style'),
      );

      const matchedStyles = createMockMatchedStyles({
        inheritedStyles: [inhStyle],
        parentNode: 'section#parent-sec',
      });

      return new CssFormatter(matchedStyles, {uid: 'child-1'});
    },
  );

  formatterTest(
    'formats inherited transition and animation styles with parent node',
    () => {
      const inhTransition = createMockStyle(
        [createMockProperty('color', 'purple')],
        undefined,
        DevTools.CSSStyleDeclaration.Type.Transition,
      );
      const inhAnimation = createMockStyle(
        [createMockProperty('color', 'orange')],
        undefined,
        DevTools.CSSStyleDeclaration.Type.Animation,
        'pulse',
      );

      const matchedStyles = createMockMatchedStyles({
        inheritedStyles: [inhTransition, inhAnimation],
        parentNode: 'div#wrapper',
      });

      return new CssFormatter(matchedStyles, {uid: 'child-elem'});
    },
  );

  formatterTest(
    'formats pseudo-elements with rules and inline pseudo styles',
    () => {
      const pseudoRule = createMockRule('button.btn::before', {
        sourceURL: 'styles.css',
        lineNumber: 20,
        columnNumber: 4,
        selectors: [{text: 'button.btn::before'}, {text: 'a.link::before'}],
        nestingSelectors: ['.btn-group'],
      });
      const beforeStyle = createMockStyle(
        [
          createMockProperty('content', '"→"'),
          createMockProperty('color', 'blue'),
        ],
        pseudoRule,
      );
      const afterStyle = createMockStyle([
        createMockProperty('content', '"*"'),
      ]);
      const matchedStyles = createMockMatchedStyles({
        pseudoStyles: new Map([
          [DevTools.Protocol.DOM.PseudoType.Before, [beforeStyle]],
          [DevTools.Protocol.DOM.PseudoType.After, [afterStyle]],
        ]),
        matchingSelectorsMap: new Map([[pseudoRule, [0]]]),
      });
      return new CssFormatter(matchedStyles, {uid: 'btn-pseudo'});
    },
  );

  formatterTest(
    'formats inherited pseudo-elements with ancestor node and resolves uid',
    () => {
      const selectionRule = createMockRule('div.container::selection', {
        sourceURL: 'theme.css',
        lineNumber: 5,
        columnNumber: 1,
      });
      const inheritedSelectionStyle = createMockStyle(
        [
          createMockProperty('color', 'white'),
          createMockProperty('background-color', 'navy'),
          createMockProperty('--selection-var', 'red'),
        ],
        selectionRule,
      );

      const inheritedHighlightStyle = createMockStyle([
        createMockProperty('color', 'yellow'),
        createMockProperty('--highlight-color', 'gold'),
      ]);

      const inheritedMarkerStyle = createMockStyle([
        createMockProperty('color', 'green'),
        createMockProperty('padding', '5px'),
      ]);

      const directMarkerStyle = createMockStyle([
        createMockProperty('content', '"•"'),
      ]);

      const parentNode = createMockNode('div.container', 10);
      const matchedStyles = createMockMatchedStyles({
        node: createMockNode('p.paragraph', 1),
        parentNode,
        inheritedStylesSet: new Set([
          inheritedSelectionStyle,
          inheritedHighlightStyle,
          inheritedMarkerStyle,
        ]),
        pseudoStyles: new Map([
          [
            DevTools.Protocol.DOM.PseudoType.Selection,
            [inheritedSelectionStyle],
          ],
          [
            DevTools.Protocol.DOM.PseudoType.Marker,
            [directMarkerStyle, inheritedMarkerStyle],
          ],
        ]),
        customHighlights: new Map([['search', [inheritedHighlightStyle]]]),
      });

      const resolveUid: UidResolver = (backendId: number) =>
        backendId === 10 ? 'cont-10' : undefined;

      return new CssFormatter(matchedStyles, {
        uid: 'para-1',
        resolveUid,
      });
    },
  );

  formatterTest('formats nested CSS rules with nesting ancestors', () => {
    const matchedStyles = createMockMatchedStyles({
      nodeStyles: [
        createMockStyle(
          [createMockProperty('color', 'blue')],
          createMockRule('& .child', {
            sourceURL: 'styles.css',
            lineNumber: 15,
            columnNumber: 2,
            nestingSelectors: ['.card'],
          }),
        ),
      ],
    });
    return new CssFormatter(matchedStyles, {uid: 'elem-child'});
  });

  formatterTest(
    'formats constructed stylesheets with and without sourceURL pragma',
    () => {
      const matchedStyles = createMockMatchedStyles({
        nodeStyles: [
          createMockStyle(
            [createMockProperty('color', 'purple')],
            createMockRule('.constructed-btn', {isConstructed: true}),
          ),
          createMockStyle(
            [createMockProperty('color', 'orange')],
            createMockRule('.themed-btn', {
              sourceURL: 'theme.css',
              lineNumber: 10,
              columnNumber: 5,
              isConstructed: true,
            }),
          ),
        ],
      });
      return new CssFormatter(matchedStyles, {uid: 'elem-constructed'});
    },
  );

  formatterTest('formats injected stylesheet rules', () => {
    const matchedStyles = createMockMatchedStyles({
      nodeStyles: [
        createMockStyle(
          [createMockProperty('display', 'none')],
          createMockRule('.extension-override', {origin: 'injected'}),
        ),
      ],
    });
    return new CssFormatter(matchedStyles, {uid: 'elem-injected'});
  });

  formatterTest('formats inspector stylesheet rules', () => {
    const matchedStyles = createMockMatchedStyles({
      nodeStyles: [
        createMockStyle(
          [createMockProperty('outline', '2px solid red')],
          createMockRule('#interactive-test', {
            sourceURL: 'inspector-stylesheet',
            origin: 'inspector',
          }),
        ),
      ],
    });
    return new CssFormatter(matchedStyles, {uid: 'elem-inspector'});
  });

  formatterTest('formats transition, animation, and attributes styles', () => {
    const transitionStyle = createMockStyle(
      [createMockProperty('opacity', '1')],
      undefined,
      DevTools.CSSStyleDeclaration.Type.Transition,
    );
    const animationStyle = createMockStyle(
      [createMockProperty('transform', 'scale(1.2)')],
      undefined,
      DevTools.CSSStyleDeclaration.Type.Animation,
      'pulse',
    );
    const tableNode = createMockNode('table#data');
    const attributesStyle = createMockStyle(
      [createMockProperty('border', '1px')],
      undefined,
      DevTools.CSSStyleDeclaration.Type.Attributes,
    );

    const matchedStyles = createMockMatchedStyles({
      node: tableNode,
      nodeStyles: [transitionStyle, animationStyle, attributesStyle],
      nodeForStyleMap: new Map([[attributesStyle, tableNode]]),
    });

    return new CssFormatter(matchedStyles, {uid: 'table-1'});
  });

  formatterTest('formats @navigation ancestor rule', () => {
    const rule = createMockRule('.nav-link', {
      navigations: [{text: 'same-document'}],
    });
    const style = createMockStyle([createMockProperty('color', 'navy')], rule);
    const matchedStyles = createMockMatchedStyles({nodeStyles: [style]});

    return new CssFormatter(matchedStyles, {uid: 'elem-nav'});
  });

  formatterTest('resolves container queries with node uid', async () => {
    const containerNode = createMockNode('aside#sidebar', 42);
    const query = {
      text: '(min-width: 300px)',
      name: 'sidebar-cq',
      getContainerForNode: async () => ({
        containerNode,
        getContainerSizeDetails: async () => ({
          queryAxis: 'inline-size',
          width: '350px',
        }),
      }),
    };
    const rule = createMockRule('.widget', {
      containerQueries: [query],
    });
    const style = createMockStyle(
      [createMockProperty('padding', '10px')],
      rule,
    );
    const matchedStyles = createMockMatchedStyles({nodeStyles: [style]});

    const containerDetails = await resolveContainerQueries(
      matchedStyles,
      (id: number) => `uid-${id}`,
    );
    return new CssFormatter(matchedStyles, {
      uid: 'elem-widget',
      containerDetails,
    });
  });

  formatterTest('maps invalid and disabled property statuses', () => {
    const validProp = createMockProperty('color', 'red');
    const invalidProp = createMockProperty('background', 'invalid-val', false, {
      parsedOk: false,
    });
    const disabledProp = createMockProperty('opacity', '0.5', false, {
      disabled: true,
    });

    const style = createMockInlineStyle([validProp, invalidProp, disabledProp]);
    const matchedStyles = createMockMatchedStyles({nodeStyles: [style]});

    return new CssFormatter(matchedStyles, {uid: 'elem-diag'});
  });

  formatterTest('formats @font-palette-values at-rule with name', () => {
    const atRule = createMockAtRule('font-palette-values', {
      name: '--my-palette',
      properties: [
        createMockProperty('font-family', 'Bixa'),
        createMockProperty('base-palette', '3'),
      ],
      sourceURL: 'https://example.com/fonts.css',
      range: {startLine: 10, startColumn: 0, endLine: 14, endColumn: 1},
    });
    const matchedStyles = createMockMatchedStyles({atRules: [atRule]});
    return new CssFormatter(matchedStyles, {uid: 'elem-at-1'});
  });

  formatterTest('formats @font-face at-rule without name', () => {
    const atRule = createMockAtRule('font-face', {
      properties: [
        createMockProperty('font-family', 'Open Sans'),
        createMockProperty('src', 'url(font.woff2)'),
      ],
    });
    const matchedStyles = createMockMatchedStyles({atRules: [atRule]});
    return new CssFormatter(matchedStyles, {uid: 'elem-at-2'});
  });

  formatterTest('formats at-rule when present in atRules', () => {
    const atRule = createMockAtRule('counter-style', {
      name: 'thumbs',
      properties: [createMockProperty('system', 'cyclic')],
    });
    const matchedStyles = createMockMatchedStyles({
      atRules: [atRule],
    });
    return new CssFormatter(matchedStyles, {uid: 'elem-at-4'});
  });

  formatterTest(
    'formats @keyframes rule with multiple steps and source location',
    () => {
      const keyframesRule = createMockKeyframesRule('slideIn', [
        {
          key: 'from',
          properties: [createMockProperty('opacity', '0')],
          sourceURL: 'animations.css',
          range: {startLine: 10, startColumn: 2, endLine: 12, endColumn: 3},
        },
        {
          key: 'to',
          properties: [createMockProperty('opacity', '1')],
          sourceURL: 'animations.css',
          range: {startLine: 13, startColumn: 2, endLine: 15, endColumn: 3},
        },
      ]);
      const matchedStyles = createMockMatchedStyles({
        keyframes: [keyframesRule],
      });

      return new CssFormatter(matchedStyles, {uid: 'elem-kf'});
    },
  );

  formatterTest('formats active and inactive @position-try rules', () => {
    const posActive = createMockPositionTryRule('--bottom', {
      active: true,
      properties: [createMockProperty('top', 'anchor(bottom)')],
      sourceURL: 'anchor.css',
      range: {startLine: 20, startColumn: 0, endLine: 22, endColumn: 1},
    });
    const posInactive = createMockPositionTryRule('--top', {
      active: false,
      properties: [createMockProperty('bottom', 'anchor(top)')],
      sourceURL: 'anchor.css',
      range: {startLine: 25, startColumn: 0, endLine: 27, endColumn: 1},
    });
    const matchedStyles = createMockMatchedStyles({
      positionTryRules: [posActive, posInactive],
    });

    return new CssFormatter(matchedStyles, {uid: 'elem-pos'});
  });

  formatterTest(
    'formats @property rules defined in stylesheets and programmatically',
    () => {
      const propStylesheet = createMockRegisteredProperty('--brand-color', {
        syntax: '"<color>"',
        inherits: false,
        initialValue: '#1a73e8',
        sourceURL: 'theme.css',
        range: {startLine: 10, startColumn: 0, endLine: 14, endColumn: 1},
      });
      const propProgrammatic = createMockRegisteredProperty('--runtime-var', {
        syntax: '"<length>"',
        inherits: true,
        initialValue: '10px',
        isProgrammatic: true,
      });
      const matchedStyles = createMockMatchedStyles({
        registeredProperties: [propStylesheet, propProgrammatic],
      });

      return new CssFormatter(matchedStyles, {uid: 'elem-prop'});
    },
  );

  formatterTest(
    'formats @function custom function rule with parameters and declarations',
    () => {
      const funcRule = createMockFunctionRule('--double(--x)', {
        functionName: '--double',
        properties: [createMockProperty('result', 'calc(var(--x) * 2)')],
        sourceURL: 'math.css',
        range: {startLine: 4, startColumn: 0, endLine: 6, endColumn: 1},
      });
      const matchedStyles = createMockMatchedStyles({
        functionRules: [funcRule],
      });

      return new CssFormatter(matchedStyles, {uid: 'elem-func'});
    },
  );
});
