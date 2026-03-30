use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerRule {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub operation: String,
    pub target_type: Option<String>,
    pub target_value: Option<String>,
    pub condition_json: Value,
    pub response_json: Option<Value>,
    pub effect: String,
    pub message: String,
    pub priority: i32,
    pub enabled: bool,
    pub version: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerRuleUpsertRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub operation: String,
    #[serde(default)]
    pub target_type: Option<String>,
    #[serde(default)]
    pub target_value: Option<String>,
    #[serde(default = "default_condition_json")]
    pub condition_json: Value,
    #[serde(default)]
    pub response_json: Option<Value>,
    #[serde(default = "default_effect")]
    pub effect: String,
    pub message: String,
    #[serde(default = "default_priority")]
    pub priority: i32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct RuleMatchInput {
    pub operation: String,
    pub target_type: Option<String>,
    pub target_value: Option<String>,
    pub context: Value,
}

#[derive(Debug, Clone)]
pub struct RuleDenyResult {
    pub message: String,
    pub response_json: Option<Value>,
}

fn default_condition_json() -> Value {
    json!(true)
}

fn default_effect() -> String {
    "deny".to_string()
}

fn default_priority() -> i32 {
    100
}

fn default_enabled() -> bool {
    true
}

pub fn validate_rule(req: &ManagerRuleUpsertRequest) -> Result<(), String> {
    if req.name.trim().is_empty() {
        return Err("规则名称不能为空".to_string());
    }
    if req.operation.trim().is_empty() {
        return Err("操作不能为空".to_string());
    }
    if req.message.trim().is_empty() {
        return Err("拒绝提示不能为空".to_string());
    }
    if !req.effect.eq_ignore_ascii_case("deny") {
        return Err("当前仅支持 deny 规则".to_string());
    }
    if let Some(target_type) = req.target_type.as_deref() {
        if target_type != "path" && target_type != "kind" {
            return Err("target_type 仅支持 path 或 kind".to_string());
        }
    }
    let _ = eval_value(&req.condition_json, &json!({}))?;
    if let Some(value) = req.response_json.as_ref() {
        if !value.is_object() {
            return Err("自定义返回内容必须是 JSON 对象".to_string());
        }
    }
    Ok(())
}

pub fn match_rule(rule: &ManagerRule, input: &RuleMatchInput) -> Result<Option<RuleDenyResult>, String> {
    if !rule.enabled || rule.operation != input.operation {
        return Ok(None);
    }
    if !target_matches(rule, input) {
        return Ok(None);
    }
    let matched = truthy(&eval_value(&rule.condition_json, &input.context)?);
    if matched && rule.effect.eq_ignore_ascii_case("deny") {
        return Ok(Some(RuleDenyResult {
            message: rule.message.clone(),
            response_json: rule.response_json.clone(),
        }));
    }
    Ok(None)
}

fn target_matches(rule: &ManagerRule, input: &RuleMatchInput) -> bool {
    match (rule.target_type.as_deref(), rule.target_value.as_deref()) {
        (Some(rule_type), Some(rule_value)) => {
            input.target_type.as_deref() == Some(rule_type)
                && input.target_value.as_deref() == Some(rule_value)
        }
        _ => true,
    }
}

fn eval_value(expr: &Value, ctx: &Value) -> Result<Value, String> {
    match expr {
        Value::Object(map) if map.len() == 1 => {
            let (op, arg) = map.iter().next().ok_or_else(|| "空表达式".to_string())?;
            match op.as_str() {
                "var" => resolve_var(arg, ctx),
                "==" => compare_op(arg, ctx, |a, b| a == b),
                "!=" => compare_op(arg, ctx, |a, b| a != b),
                "and" => logical_and(arg, ctx),
                "or" => logical_or(arg, ctx),
                "!" => Ok(Value::Bool(!truthy(&eval_value(arg, ctx)?))),
                _ => Err(format!("不支持的条件操作: {op}")),
            }
        }
        _ => Ok(expr.clone()),
    }
}

fn resolve_var(arg: &Value, ctx: &Value) -> Result<Value, String> {
    let Some(path) = arg.as_str() else {
        return Err("var 操作需要字符串参数".to_string());
    };
    Ok(lookup_path(ctx, path).cloned().unwrap_or(Value::Null))
}

fn compare_op<F>(arg: &Value, ctx: &Value, cmp: F) -> Result<Value, String>
where
    F: Fn(&Value, &Value) -> bool,
{
    let Some(items) = arg.as_array() else {
        return Err("比较操作需要数组参数".to_string());
    };
    if items.len() != 2 {
        return Err("比较操作需要两个参数".to_string());
    }
    let left = eval_value(&items[0], ctx)?;
    let right = eval_value(&items[1], ctx)?;
    Ok(Value::Bool(cmp(&left, &right)))
}

fn logical_and(arg: &Value, ctx: &Value) -> Result<Value, String> {
    let Some(items) = arg.as_array() else {
        return Err("and 操作需要数组参数".to_string());
    };
    for item in items {
        if !truthy(&eval_value(item, ctx)?) {
            return Ok(Value::Bool(false));
        }
    }
    Ok(Value::Bool(true))
}

fn logical_or(arg: &Value, ctx: &Value) -> Result<Value, String> {
    let Some(items) = arg.as_array() else {
        return Err("or 操作需要数组参数".to_string());
    };
    for item in items {
        if truthy(&eval_value(item, ctx)?) {
            return Ok(Value::Bool(true));
        }
    }
    Ok(Value::Bool(false))
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(v) => v.as_i64().unwrap_or(0) != 0 || v.as_f64().unwrap_or(0.0) != 0.0,
        Value::String(v) => !v.is_empty(),
        Value::Array(v) => !v.is_empty(),
        Value::Object(v) => !v.is_empty(),
    }
}

fn lookup_path<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = root;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}
