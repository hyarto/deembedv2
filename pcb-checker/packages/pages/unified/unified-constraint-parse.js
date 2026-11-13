/* ============================================================================
 * unified-constraint-parse.js —— 综合一体化工作台：复用 ConstraintParser 引擎解析与逐层展开
 * ========================================================================== */
function chipMeta(name) { return ConstraintParser.chipMeta(name); }
function orderChips(keys, map) { return ConstraintParser.orderChips(keys, map); }
function detectKind(filename, text) { return ConstraintParser.detectKind(filename, text); }
function scopeOf(name) { return ConstraintParser.scopeOf(name); }
function typeOf(name, cat) { return ConstraintParser.typeOf(name, cat); }
function makeConstraintName(scheme, item) { return ConstraintParser.makeConstraintName(scheme, item); }
function parseConstraintText(text, filename) { return ConstraintParser.parseConstraintText(text, filename); }
function splitNameScope(raw) { return ConstraintParser.splitNameScope(raw); }
function fanLayerOf(set) { return ConstraintParser.fanLayerOf(set); }
function isFanScope(scope) { return ConstraintParser.isFanScope(scope); }
function layersForScope(scope, n, fan) { return ConstraintParser.layersForScope(scope, n, fan); }
function applyScopes(scopes, n, fan) { return ConstraintParser.applyScopes(scopes, n, fan); }
function maxLayer(scopes, n, fan) { return ConstraintParser.maxLayer(scopes, n, fan); }
function buildConstraints(rules) { return ConstraintParser.buildConstraints(rules); }

function reexpandAll() {
  const n = unifiedLayerCount();
  ConstraintParser.expandConstraintSets(State.rules.constraintSets || [], n);
}
