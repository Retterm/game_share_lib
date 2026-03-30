import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "../components/page/PageHeader";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { createGamePanelApi } from "../gamePanelApi";
import { getPanelProps } from "../panel";

const api = createGamePanelApi();

interface ManagerConfigData {
  loki?: { configured?: boolean; url?: string; tenant?: string; basic_auth_configured?: boolean };
  grafana?: { configured?: boolean };
  pushgateway?: { configured?: boolean };
  other?: {
    docker_image?: string;
    rpchub_online?: number;
  };
}

interface ManagerRule {
  id: number;
  name: string;
  description?: string | null;
  operation: string;
  target_type?: string | null;
  target_value?: string | null;
  condition_json: any;
  response_json?: any;
  message: string;
  priority: number;
  enabled: boolean;
  version: number;
}

interface ManagerRuleRevision {
  id: number;
  rule_id: number;
  version: number;
  created_at: string;
}

interface ManagerRuleHit {
  id: number;
  operation: string;
  target_type?: string | null;
  target_value?: string | null;
  message: string;
  created_at: string;
}

interface RuleFormState {
  name: string;
  description: string;
  operation: string;
  target_type: string;
  target_value: string;
  condition_field: string;
  condition_operator: "==" | "!=";
  condition_value: string;
  message: string;
  response_json_text: string;
  priority: number;
  enabled: boolean;
}

const defaultForm = (): RuleFormState => ({
  name: "",
  description: "",
  operation: "config.update",
  target_type: "kind",
  target_value: "server_config",
  condition_field: "server.runtime_state",
  condition_operator: "!=",
  condition_value: "stopped",
  message: "当前规则不允许执行该操作",
  response_json_text: "",
  priority: 100,
  enabled: true,
});

function parseConditionValue(raw: string) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") return num;
  return raw;
}

function buildConditionJson(form: RuleFormState) {
  return {
    [form.condition_operator]: [{ var: form.condition_field }, parseConditionValue(form.condition_value)],
  };
}

function parseResponseJsonText(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("自定义返回内容必须是 JSON 对象");
  }
  return parsed;
}

function formFromRule(rule: ManagerRule): RuleFormState {
  const form = defaultForm();
  form.name = rule.name || "";
  form.description = rule.description || "";
  form.operation = rule.operation || form.operation;
  form.target_type = rule.target_type || form.target_type;
  form.target_value = rule.target_value || "";
  form.message = rule.message || form.message;
  form.response_json_text = rule.response_json ? JSON.stringify(rule.response_json, null, 2) : "";
  form.priority = rule.priority ?? form.priority;
  form.enabled = !!rule.enabled;
  const condition = rule.condition_json;
  if (condition && typeof condition === "object") {
    if (Array.isArray(condition["=="]) && condition["=="].length === 2) {
      form.condition_operator = "==";
      form.condition_field = condition["=="]?.[0]?.var || form.condition_field;
      form.condition_value = String(condition["=="]?.[1] ?? form.condition_value);
    } else if (Array.isArray(condition["!="]) && condition["!="].length === 2) {
      form.condition_operator = "!=";
      form.condition_field = condition["!="]?.[0]?.var || form.condition_field;
      form.condition_value = String(condition["!="]?.[1] ?? form.condition_value);
    }
  }
  return form;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SharedManagerOverviewPage(props: { gameName: string }) {
  const panelProps = useMemo(() => getPanelProps(), []);
  const [cfg, setCfg] = useState<ManagerConfigData | null>(null);
  const [rules, setRules] = useState<ManagerRule[]>([]);
  const [revisions, setRevisions] = useState<ManagerRuleRevision[]>([]);
  const [hits, setHits] = useState<ManagerRuleHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [rollbackingRevisionId, setRollbackingRevisionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleFormState>(defaultForm);

  const loadManagerConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      setCfg((await api.getManagerConfig<ManagerConfigData>()) || null);
    } catch (nextError: any) {
      setError(nextError?.message || "加载 manager 配置失败");
      setCfg(null);
    } finally {
      setLoading(false);
    }
  };

  const loadRules = async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const [ruleList, hitList] = await Promise.all([
        api.listManagerRules<ManagerRule[]>(),
        api.listManagerRuleHits<ManagerRuleHit[]>(),
      ]);
      const nextRules = Array.isArray(ruleList) ? ruleList : [];
      setRules(nextRules);
      setHits(Array.isArray(hitList) ? hitList : []);
      if (editingRuleId && !nextRules.some((rule) => rule.id === editingRuleId)) {
        setEditingRuleId(null);
        setRevisions([]);
        setForm(defaultForm());
      }
    } catch (nextError: any) {
      setRulesError(nextError?.message || "加载规则失败");
      setRules([]);
      setHits([]);
    } finally {
      setRulesLoading(false);
    }
  };

  const loadRevisions = async (ruleId: number) => {
    setRevisionsLoading(true);
    setRulesError(null);
    try {
      const data = await api.listManagerRuleRevisions<ManagerRuleRevision[]>(ruleId);
      setRevisions(Array.isArray(data) ? data : []);
    } catch (nextError: any) {
      setRulesError(nextError?.message || "加载规则版本失败");
      setRevisions([]);
    } finally {
      setRevisionsLoading(false);
    }
  };

  useEffect(() => {
    void loadManagerConfig();
    void loadRules();
  }, []);

  const saveRule = async () => {
    setSaving(true);
    setRulesError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      operation: form.operation,
      target_type: form.target_type || null,
      target_value: form.target_value.trim() || null,
      condition_json: buildConditionJson(form),
      response_json: parseResponseJsonText(form.response_json_text),
      effect: "deny",
      message: form.message.trim(),
      priority: Number(form.priority) || 100,
      enabled: form.enabled,
    };
    try {
      const saved = editingRuleId
        ? await api.updateManagerRule<ManagerRule>(editingRuleId, payload)
        : await api.createManagerRule<ManagerRule>(payload);
      await loadRules();
      setEditingRuleId(saved.id);
      setForm(formFromRule(saved));
      await loadRevisions(saved.id);
    } catch (nextError: any) {
      setRulesError(nextError?.message || "保存规则失败");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditingRuleId(null);
    setForm(defaultForm());
    setRevisions([]);
  };

  const rollbackRule = async (ruleId: number, revisionId: number) => {
    setRollbackingRevisionId(revisionId);
    setRulesError(null);
    try {
      const saved = await api.rollbackManagerRule<ManagerRule>(ruleId, revisionId);
      await loadRules();
      setEditingRuleId(saved.id);
      setForm(formFromRule(saved));
      await loadRevisions(saved.id);
    } catch (nextError: any) {
      setRulesError(nextError?.message || "回滚规则失败");
    } finally {
      setRollbackingRevisionId(null);
    }
  };

  return (
    <div className="min-h-full bg-background px-4 py-5 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        {error ? (
          <Alert variant="destructive">
            {error}
          </Alert>
        ) : null}
        {rulesError ? (
          <Alert variant="destructive">
            {rulesError}
          </Alert>
        ) : null}

        <PageHeader
          eyebrow={`${props.gameName} Manager Overview`}
          title="Manager Rules And Runtime Overview"
          description="这里直接承载 manager 配置、规则编辑、版本历史和命中记录，不再保留占位入口页。"
          actions={
            <>
              <Button onClick={() => { void loadManagerConfig(); void loadRules(); if (editingRuleId) void loadRevisions(editingRuleId); }} disabled={loading || rulesLoading || revisionsLoading}>
              {loading || rulesLoading || revisionsLoading ? "Loading..." : "Refresh"}
              </Button>
              <Button variant="outline" onClick={resetForm}>New Rule</Button>
            </>
          }
        />

        <div className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entry</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-sm">
              <div className="text-muted-foreground">module</div>
              <div>overview</div>
              <div className="text-muted-foreground">apiBase</div>
              <div className="break-all">{panelProps?.apiBase || "same-origin"}</div>
              <div className="text-muted-foreground">adminToken</div>
              <div>{panelProps?.adminToken ? "present" : "missing"}</div>
              <div className="text-muted-foreground">rpchub_online</div>
              <div>{typeof cfg?.other?.rpchub_online === "number" ? cfg.other.rpchub_online : "-"}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manager Config</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-sm">
              <div className="text-muted-foreground">image</div>
              <div className="break-all">{cfg?.other?.docker_image || "-"}</div>
              <div className="text-muted-foreground">loki</div>
              <div>{cfg?.loki?.configured ? "configured" : "not configured"}</div>
              <div className="text-muted-foreground">grafana</div>
              <div>{cfg?.grafana?.configured ? "configured" : "not configured"}</div>
              <div className="text-muted-foreground">pushgateway</div>
              <div>{cfg?.pushgateway?.configured ? "configured" : "not configured"}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rules Snapshot</CardTitle>
              <CardDescription>当前启用规则、命中记录与版本回滚共用同一条管理面。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-border bg-background/60 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">rules</div>
                <div className="mt-2 text-2xl font-semibold">{rules.length}</div>
              </div>
              <div className="rounded-md border border-border bg-background/60 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">hits</div>
                <div className="mt-2 text-2xl font-semibold">{hits.length}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!rules.length ? <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No rules</div> : null}
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  className={`w-full rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                    editingRuleId === rule.id
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-background/60 hover:bg-accent hover:text-accent-foreground"
                  }`}
                  onClick={() => {
                    setEditingRuleId(rule.id);
                    setForm(formFromRule(rule));
                    void loadRevisions(rule.id);
                  }}
                >
                  <div className="font-medium">{rule.name}</div>
                  <div className="mt-1 text-muted-foreground">{rule.operation} / {rule.target_type || "*"} / {rule.target_value || "*"}</div>
                  <div className="mt-2 text-xs text-muted-foreground">priority {rule.priority} · v{rule.version} · {rule.enabled ? "enabled" : "disabled"}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{editingRuleId ? `Edit Rule #${editingRuleId}` : "Create Rule"}</CardTitle>
              <CardDescription>直接沿用成熟游戏的规则录入方式，统一 manager 规则结构。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Rule name" />
                <Input value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Description" />
                <Input value={form.operation} onChange={(event) => setForm((prev) => ({ ...prev, operation: event.target.value }))} placeholder="Operation" />
                <Input value={form.target_type} onChange={(event) => setForm((prev) => ({ ...prev, target_type: event.target.value }))} placeholder="Target type" />
                <Input value={form.target_value} onChange={(event) => setForm((prev) => ({ ...prev, target_value: event.target.value }))} placeholder="Target value" />
                <Input value={form.condition_field} onChange={(event) => setForm((prev) => ({ ...prev, condition_field: event.target.value }))} placeholder="Condition field" />
                <Input value={form.condition_operator} onChange={(event) => setForm((prev) => ({ ...prev, condition_operator: event.target.value as "==" | "!=" }))} placeholder="Operator" />
                <Input value={form.condition_value} onChange={(event) => setForm((prev) => ({ ...prev, condition_value: event.target.value }))} placeholder="Condition value" />
                <Input value={form.message} onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))} placeholder="Deny message" />
                <Input value={String(form.priority)} onChange={(event) => setForm((prev) => ({ ...prev, priority: Number(event.target.value) || 100 }))} placeholder="Priority" />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))} />
                Enabled
              </label>
              <textarea
                className="min-h-40 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.response_json_text}
                onChange={(event) => setForm((prev) => ({ ...prev, response_json_text: event.target.value }))}
                placeholder="Optional response_json object"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveRule()} disabled={saving}>{saving ? "Saving..." : "Save Rule"}</Button>
                <Button variant="outline" onClick={resetForm}>Reset</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revisions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!revisions.length ? (
                <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  {revisionsLoading ? "Loading revisions..." : "No revisions"}
                </div>
              ) : null}
              {revisions.map((revision) => (
                <div key={revision.id} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">v{revision.version}</div>
                    <div className="mt-1 text-muted-foreground">{formatTime(revision.created_at)}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void rollbackRule(revision.rule_id, revision.id)} disabled={rollbackingRevisionId === revision.id}>
                    {rollbackingRevisionId === revision.id ? "Rolling back..." : "Rollback"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Hits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!hits.length ? <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No hits</div> : null}
              {hits.map((hit) => (
                <div key={hit.id} className="rounded-md border border-border bg-background/60 px-4 py-3 text-sm">
                  <div className="font-medium">{hit.operation} · {hit.target_type || "*"} / {hit.target_value || "*"}</div>
                  <div className="mt-1 text-muted-foreground">{hit.message}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{formatTime(hit.created_at)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
