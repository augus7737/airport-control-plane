import {
  getNextPath,
  getOperatorSession,
  loginOperator,
  normalizeNextPath,
} from "./auth-client.js";

const routeLabels = [
  ["/node.html", "节点详情"],
  ["/nodes.html", "节点清单"],
  ["/tasks.html", "任务中心"],
  ["/terminal.html", "运维终端"],
  ["/system-templates.html", "系统模板"],
  ["/system-users.html", "系统用户"],
  ["/access-users.html", "接入用户"],
  ["/routes.html", "中转拓扑"],
  ["/", "总览"],
];

function resolveTargetLabel(nextPath) {
  const normalized = normalizeNextPath(nextPath, window);
  const matched = routeLabels.find(([prefix]) => prefix === "/" ? normalized === "/" : normalized.startsWith(prefix));
  return matched ? matched[1] : "控制台页面";
}

function setMessage(text, tone = "muted") {
  const message = document.getElementById("login-message");
  if (!message) {
    return;
  }
  message.textContent = text || "";
  message.dataset.tone = tone;
}

function setSubmitting(submitting) {
  const button = document.getElementById("login-submit");
  if (!button) {
    return;
  }
  button.disabled = submitting;
  button.textContent = submitting ? "登录中..." : "登录控制台";
}

async function bootstrapLoginPage() {
  const nextPath = getNextPath(window);
  const nextLabel = resolveTargetLabel(nextPath);
  const nextValue = document.getElementById("login-next-value");
  if (nextValue) {
    nextValue.textContent = nextLabel;
  }

  const session = await getOperatorSession({ force: true, windowRef: window });
  if (session.authenticated) {
    window.location.replace(nextPath || "/");
    return;
  }

  const form = document.getElementById("login-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username || !password) {
      setMessage("请输入账号和密码。", "error");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      await loginOperator({
        username,
        password,
      });
      window.location.assign(nextPath || "/");
    } catch (error) {
      if (error?.status === 404) {
        setMessage("控制面登录接口尚未接通，请先完成后端鉴权实现。", "error");
      } else if (error?.status === 429) {
        setMessage("登录尝试过于频繁，请稍后再试。", "error");
      } else {
        setMessage(error?.message || "登录失败，请检查账号密码后重试。", "error");
      }
      setSubmitting(false);
    }
  });
}

bootstrapLoginPage();
