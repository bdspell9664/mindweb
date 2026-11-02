import { useState } from 'react';
import { store, useStore } from '../store';

type Form = 'idle' | 'signin' | 'signup';

export default function AuthPanel() {
  const { user, backend, authBusy } = useStore();
  const [form, setForm] = useState<Form>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async () => {
    const mail = email.trim();
    if (!mail) {
      store.notify({ kind: 'error', text: '先填邮箱' });
      return;
    }
    if (password.length < 8) {
      store.notify({ kind: 'error', text: '密码至少 8 位' });
      return;
    }
    const ok = form === 'signup'
      ? await store.signUp(mail, password)
      : await store.signIn(mail, password);
    if (ok) {
      setPassword('');
      setForm('idle');
    }
  };

  return (
    <div className="field">
      <label>账号</label>

      {user ? (
        <>
          <div className="row">
            <span style={{ fontSize: 14 }}>{user.email}</span>
            <span className="hint" style={{ margin: 0 }}>· 云端已连接</span>
            <span className="spacer" />
            <button type="button" className="btn btn-sm" onClick={() => void store.signOut()}>
              退出登录
            </button>
          </div>
          <div className="hint">
            日志存在云端（Cloudflare D1），本机留一份缓存供离线查看。换设备登录同一个邮箱就能看到。
          </div>
        </>
      ) : backend === 'local' ? (
        <div className="hint" style={{ marginTop: 0 }}>
          这个地址没有连上后端，只能本地使用。要用账号，请把应用部署到 Cloudflare（README 里有步骤）。
        </div>
      ) : form === 'idle' ? (
        <>
          <div className="hint" style={{ marginTop: 0 }}>
            登录后日志存到云端，换设备也能看到。不登录也能继续用，只是数据只留在这台设备上。
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => setForm('signin')}>
              登录
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setForm('signup')}>
              注册
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className={`chip ${form === 'signin' ? 'is-focus' : ''}`}
              onClick={() => setForm('signin')}
            >
              登录
            </button>
            <button
              type="button"
              className={`chip ${form === 'signup' ? 'is-focus' : ''}`}
              onClick={() => setForm('signup')}
            >
              注册
            </button>
          </div>

          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            autoComplete="username"
            spellCheck={false}
          />
          <input
            className="input"
            style={{ marginTop: 10 }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 8 位）"
            autoComplete={form === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />

          <div className="row row-end" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setForm('idle')}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={authBusy}
            >
              {authBusy ? '处理中…' : form === 'signup' ? '注册并登录' : '登录'}
            </button>
          </div>

          <div className="hint">
            {form === 'signup'
              ? '第一次登录会把本地已有的日志一并搬上云（云端已有的同名日期不会被覆盖）。'
              : '忘记密码目前找不回来——没有找回邮箱的流程，请自己记好。'}
          </div>
        </>
      )}
    </div>
  );
}
