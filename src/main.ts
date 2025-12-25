import {
  App,
  Modal,
  Notice,
  Plugin,
  Setting,
  FuzzySuggestModal,
  TFile,
  MarkdownRenderer,
} from "obsidian"

interface AppWithCommands extends App {
  commands: {
    executeCommandById: (id: string) => void;
  };
}

type AuthState = {
  currentCharacter: string | null;
  isAuthenticated: boolean;
  currentGroups: string[];
};

type UserEntry = { name: string; salt: string; hash: string; groups?: string[] };
type UsersDb = { users: UserEntry[] };

const USERS_PATH = "DnDAuth/users.json";
const DEFAULT_STATE: AuthState = {
  currentCharacter: null,
  isAuthenticated: false,
  currentGroups: [],
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function sha256Base64(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(hashBuf));
}

function makeSalt(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToBase64(arr);
}

function addActionButton(
  parent: HTMLElement,
  label: string,
  action: () => void
) {
  const btn = parent.createEl("button", { text: label });
  btn.addClass("am-action-btn");
  btn.addEventListener("click", action);
}


type DndGateParsed = { groups: string[]; body: string; requireAuth: boolean };

function parseDndGate(source: string): DndGateParsed {
  const lines = source.split("\n");
  let groups: string[] = [];
  let requireAuth = true;
  let startBodyAt = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;         
    const line = raw.trim();

    if (line === "---") {
      startBodyAt = i + 1;
      break;
    }
    if (!line) continue;

    const mg = line.match(/^groups\s*:\s*(.+)$/i);
    if (mg && mg[1]) {                        // <-- Fix für Zeile 61
      groups = mg[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }

    const ma = line.match(/^requireAuth\s*:\s*(true|false)$/i);
    if (ma && ma[1]) {                        // <-- Fix für Zeile 67
      requireAuth = ma[1].toLowerCase() === "true";
      continue;
    }
  }

  const body = lines.slice(startBodyAt).join("\n");
  return { groups, body, requireAuth };
}



export default class AuthentificatorPlugin extends Plugin {
  private state: AuthState = { ...DEFAULT_STATE };
  private statusEl: HTMLElement | null = null;

  async onload() {
    this.state = { ...DEFAULT_STATE, ...(await this.loadData()) };
    await this.ensureUsersFile();

    // Statusbar
    this.statusEl = this.addStatusBarItem();
    this.renderStatus();

    if (this.statusEl) {
      this.statusEl.addClass("am-status-clickable");
      this.statusEl.addEventListener("click", () => {
        new StatusMenuModal(this.app, this).open();
      });
    }


    this.registerMarkdownCodeBlockProcessor("dndadmin", async (source, el) => {
      if (!this.isAdmin()) {
        el.createEl("div", { text: "Admin only. 🔒" });
        return;
      }

      // Buttons row
      const row = el.createDiv();

      const createBtn = row.createEl("button", { text: "Create / update user" });
      createBtn.onclick = () => {
        this.execCommand(
          "account-manager:authentificator-admin-create-update-user"
        );
      };

      const reportBtn = row.createEl("button", { text: "Regenerate report" });
      reportBtn.addClass("am-report-btn");
      reportBtn.onclick = async () => {
        await this.generateUserReportNote();
        this.refreshAllMarkdownViews();
        new Notice("Report updated");
      };


      el.createEl("hr");

      // Live user list
      const users = await this.loadUsers();
      for (const u of users) {
        el.createDiv({
          text: `${u.name} — ${(u.groups ?? []).join(", ") || "-"}`,
        });
      }
    });


    // --- Commands ---
    this.addCommand({
      id: "authentificator-admin-setup-admin-area",
      name: "Admin: Setup Admin Area",
      callback: async () => {
        if (!this.isAdmin()) {
          new Notice("Admin only, please login as admin.");
          return;
        }

        await this.ensureFolder("Admin Area");

        await this.upsertFile(
          "Admin Area/UserManagement.md",
          [
            "---",
            "dnd_access_groups: [admin]",
            "dnd_require_auth: true",
            "generated: true",
            "---",
            "",
            "# Admin Area – User Management",
            "",
            "```dndadmin",
            "mode: users",
            "```",
            "",
          ].join("\n")
        );

        await this.generateUserReportNote(); // erstellt/aktualisiert Admin Area/UserReport.md
        this.refreshAllMarkdownViews();

        const f = this.app.vault.getAbstractFileByPath("Admin Area/UserManagement.md");
        if (f) await this.app.workspace.getLeaf(true).openFile(f as any);
        new Notice("Admin area created/updated.");
      },
    });

    this.addCommand({
      id: "authentificator-select-character",
      name: "Select character",
      callback: async () => {
        const users = await this.loadUsers();
        const picked = await new Promise<UserEntry | null>((resolve) => {
          new ButtonUserPickModal(this.app, users, resolve).open();
        });

        if (!picked) return;

        this.state.currentCharacter = picked.name;
        this.state.isAuthenticated = false;
        this.state.currentGroups = [];
        await this.saveData(this.state);
        this.renderStatus();
        this.refreshAllMarkdownViews();
        new Notice(`Selected character: ${picked.name}`);
      },
    });

    this.addCommand({
      id: "authentificator-login",
      name: "Login (password)",
      callback: async () => {
        const user = this.state.currentCharacter;
        if (!user) {
          new Notice("Select a character first.");
          return;
        }

        const password = await new Promise<string | null>((resolve) => {
          new PasswordModal(this.app, resolve).open();
        });
        if (!password) return;

        const ok = await this.verifyPassword(user, password);
        if (!ok) {
          this.state.isAuthenticated = false;
          this.state.currentGroups = [];
          await this.saveData(this.state);
          this.renderStatus();
          this.refreshAllMarkdownViews();
          new Notice("❌ Login failed.");
          return;
        }

        const users = await this.loadUsers();
        const entry = users.find((u) => u.name === user);

        this.state.isAuthenticated = true;
        this.state.currentGroups = (entry?.groups ?? []).map(String);
        await this.saveData(this.state);
        this.renderStatus();
        this.refreshAllMarkdownViews();
        new Notice(`Logged in as ${user}`);
      },
    });

    this.addCommand({
      id: "authentificator-logout",
      name: "Logout",
      callback: async () => {
        this.state = { ...DEFAULT_STATE };
        await this.saveData(this.state);
        this.renderStatus();
        this.refreshAllMarkdownViews();
        new Notice("Logged out.");
      },
    });

    this.addCommand({
      id: "authentificator-open-gated-note",
      name: "Open gated note…",
      callback: async () => {
        if (!this.isAdmin() && !this.state.isAuthenticated) {
          new Notice("Please login first.");
          return;
        }
        new LiveFilePickModal(this.app, this).open();
      },
    });

    // --- Admin: Create/Update user ---
    this.addCommand({
      id: "authentificator-admin-create-update-user",
      name: "Admin: create/update user",
      callback: async () => {
        if (!this.isAdmin()) {
          new Notice("Admin only, please login as admin.");
          return;
        }

        const result = await new Promise<
          { name: string; password: string; groups: string } | null
        >((resolve) => {
          new CreateUserModal(this.app, resolve).open();
        });
        if (!result) return;

        const name = result.name.trim();
        const password = result.password;
        if (!name) return void new Notice("User name cannot be empty.");
        if (!password) return void new Notice("Password cannot be empty.");

        let groups = result.groups
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        // Admin safety
        if (name === "Admin" && !groups.includes("admin")) groups.push("admin");

        const users = await this.loadUsers();
        const salt = makeSalt();
        const hash = await sha256Base64(`${salt}:${password}`);

        const idx = users.findIndex((u) => u.name === name);
        const entry: UserEntry = { name, salt, hash, groups };


        let target: typeof entry | undefined = undefined;
        if (idx >= 0) target = entry;

        else users.push(entry);

        await this.saveUsers(users);
        this.refreshAllMarkdownViews();
        new Notice(`✅ Saved user: ${name}`);
      },
    });

    // --- Admin: Toggle group for user ---
    this.addCommand({
      id: "authentificator-admin-toggle-group",
      name: "Admin: Toggle group for user",
      callback: async () => {
        if (!this.isAdmin()) {
          new Notice("Admin only, please login as admin.");
          return;
        }

        const group = await new Promise<string | null>((resolve) => {
          new SingleLineModal(
            this.app,
            "Toggle group",
            "Group name (e.g. session_07_reveal)",
            resolve
          ).open();
        });
        if (!group) return;
        const g = group.trim();

        const users = await this.loadUsers();
        const picked = await new Promise<UserEntry | null>((resolve) => {
          new UserPickModal(
            this.app,
            users.filter((u) => u.name !== "Admin"),
            resolve
          ).open();
        });
        if (!picked) return;

        const idx = users.findIndex((u) => u.name === picked.name);
        if (idx < 0) return;

        const target = users[idx];
        if (!target) return;

        // ab hier nur noch target benutzen
        const set = new Set((target.groups ?? []).map(String));
        // ... set bearbeiten
        target.groups = Array.from(set);

        if (this.state.currentCharacter === target.name && this.state.isAuthenticated) {
          this.state.currentGroups = target.groups ?? [];
        }



        await this.saveUsers(users);

        // refresh session groups if same user currently logged in
        if (
          this.state.currentCharacter === target.name &&
          this.state.isAuthenticated
        ) {
          this.state.currentGroups = target.groups ?? [];
          await this.saveData(this.state);
          this.renderStatus();
        }

        this.refreshAllMarkdownViews();

        const wasAdded = target.groups?.includes(g) ?? false;
        const action = wasAdded ? "added" : "removed";

        new Notice(
          `✅ ${action.toUpperCase()}: "${g}" ${action === "added" ? "to" : "from"} ${picked.name}`
        );

      },
    });

    // --- Admin: Toggle group for ALL players ---
    this.addCommand({
      id: "authentificator-admin-toggle-group-all",
      name: "Admin: Toggle group for ALL players",
      callback: async () => {
        if (!this.isAdmin()) {
          new Notice("🚫 Admin only. Please login as Admin.");
          return;
        }

        const group = await new Promise<string | null>((resolve) => {
          new SingleLineModal(
            this.app,
            "Toggle group for ALL",
            "Group name (e.g. session_07_reveal)",
            resolve
          ).open();
        });
        if (!group) return;

        const g = group.trim();
        const users = await this.loadUsers();
        const players = users.filter((u) => u.name !== "Admin");

        const countHas = players.filter((u) => (u.groups ?? []).includes(g))
          .length;
        const shouldAdd = countHas < Math.ceil(players.length / 2);

        for (const u of players) {
          const set = new Set((u.groups ?? []).map(String));
          if (shouldAdd) set.add(g);
          else set.delete(g);
          u.groups = Array.from(set);
        }

        await this.saveUsers(users);
        this.refreshAllMarkdownViews();
        new Notice(
          `✅ ${shouldAdd ? "Added" : "Removed"} "${g}" ${shouldAdd ? "to" : "from"
          } ALL players`
        );
      },
    });

    // --- Admin: Reset temporary groups (prefix) ---
    this.addCommand({
      id: "authentificator-admin-reset-temp-groups",
      name: "Admin: Reset temporary groups",
      callback: async () => {
        if (!this.isAdmin()) {
          new Notice("Admin only, please login as admin.");
          return;
        }

        const prefix = await new Promise<string | null>((resolve) => {
          new SingleLineModal(
            this.app,
            "Reset temporary groups",
            "Prefix (default: session_)",
            resolve
          ).open();
        });

        const p = prefix && prefix.trim().length > 0 ? prefix.trim() : "session_";
        const users = await this.loadUsers();

        for (const u of users) {
          if (u.name === "Admin") continue;
          u.groups = (u.groups ?? []).filter((gr) => !String(gr).startsWith(p));
        }

        await this.saveUsers(users);
        this.refreshAllMarkdownViews();
        new Notice(`Removed all groups starting with "${p}" from all players`);
      },
    });

    // --- Admin: Who has group? ---
    this.addCommand({
      id: "authentificator-admin-who-has-group",
      name: "Admin: Who has group?",
      callback: async () => {
        if (!this.isAdmin()) {
          new Notice("Admin only, please login as admin.");
          return;
        }

        const group = await new Promise<string | null>((resolve) => {
          new SingleLineModal(
            this.app,
            "Who has group?",
            "Group name (e.g. party)",
            resolve
          ).open();
        });
        if (!group) return;

        const g = group.trim();
        const users = await this.loadUsers();
        const holders = users
          .filter((u) => u.name !== "Admin")
          .filter((u) => (u.groups ?? []).includes(g))
          .map((u) => u.name);

        new Notice(
          holders.length ? `✅ "${g}" holders: ${holders.join(", ")}` : `ℹ️ Nobody has "${g}"`
        );
      },
    });


    // --- Rendering: dndgate codeblock ---
    this.registerMarkdownCodeBlockProcessor("dndgate", async (source, el, ctx) => {
      const parsed = parseDndGate(source);

      // Admin override
      if (this.isAdmin()) {
        await MarkdownRenderer.renderMarkdown(parsed.body.trim(), el, ctx.sourcePath, this);
        return;
      }

      const authed = this.state.isAuthenticated;
      const authOk = parsed.requireAuth ? authed : true;

      const required = parsed.groups;
      const userGroups = this.state.currentGroups ?? [];
      const groupOk =
        required.length > 0 && required.some((g) => userGroups.includes(g));

      if (!authOk || !groupOk) {
        el.createEl("div", { text: "🔒 Access denied." });
        return;
      }

      await MarkdownRenderer.renderMarkdown(parsed.body.trim(), el, ctx.sourcePath, this);
    });



    // --- Rendering: whole-note frontmatter gate + friendly UI ---
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (this.isAdmin()) return;

      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!file) return;

      const cache = this.app.metadataCache.getFileCache(file as any);
      const fm = cache?.frontmatter;
      if (!fm) return;

      const requiredGroups: string[] = Array.isArray(fm.dnd_access_groups)
        ? fm.dnd_access_groups
        : [];
      if (requiredGroups.length === 0) return;

      const requireAuth: boolean =
        typeof fm.dnd_require_auth === "boolean" ? fm.dnd_require_auth : true;

      const authed = this.state.isAuthenticated;
      const authOk = requireAuth ? authed : true;

      const userGroups = this.state.currentGroups ?? [];
      const groupOk = requiredGroups.some((g) => userGroups.includes(g));

      if (authOk && groupOk) return;

      el.empty();
      const box = el.createDiv({ cls: "authentificator-denied" });
      box.createEl("h3", { text: "🔒 Access denied" });

      if (!this.state.currentCharacter) {
        box.createEl("p", { text: "No character selected." });
        addActionButton(box, "Select character", () => {
          this.execCommand(
            "account-manager:authentificator-select-character"
          );
        });
        return;
      }

      if (!this.state.isAuthenticated) {
        box.createEl("p", { text: "You must login to access this content." });
        addActionButton(box, "Login", () => {
          this.execCommand(
            "account-manager:authentificator-login"
          );
        });
      }

      addActionButton(box, "Open gated note…", () => {
        this.execCommand(
          "account-manager:authentificator-open-gated-note"
        );
      });
    });

  }

  onunload() { }

  private renderStatus() {
    if (!this.statusEl) return;
    const c = this.state.currentCharacter ?? "none";
    const lock = this.state.isAuthenticated ? "unlocked" : "locked";
    const g = this.isAdmin()
      ? "ADMIN"
      : this.state.currentGroups?.length
        ? this.state.currentGroups.join(",")
        : "-";
    this.statusEl.setText(`authentificator: ${c} (${lock}) [${g}]`);
  }

    private execCommand(id: string) {
      (this.app as any).commands?.executeCommandById?.(id);
    }

  private isAdmin(): boolean {
    return this.state.currentCharacter === "Admin" && this.state.isAuthenticated;
  }

  private refreshAllMarkdownViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view: any = leaf.view;
      if (!view) return;
      if (view.getViewType?.() === "markdown") {
        view.previewMode?.rerender?.(true);
        view.currentMode?.rerender?.(true);
        view.render?.();
        const file = view.file;
        if (file) {
          leaf
            .openFile(file, { active: false, state: leaf.getViewState().state })
            .catch(() => { });
        }
      }
    });
  }

  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) return;
    await this.app.vault.createFolder(path).catch(() => { });
  }

  private async upsertFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing) {
      await this.app.vault.modify(existing as any, content);
      return;
    }

    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      const folder = path.substring(0, slash);
      await this.ensureFolder(folder);
    }

    await this.app.vault.create(path, content).catch(() => { });
  }


  private async ensureUsersFile(): Promise<UsersDb> {
    const existing = this.app.vault.getAbstractFileByPath(USERS_PATH);

    if (!existing) {
      const db: UsersDb = {
        users: [
          {
            name: "Admin",
            salt: "initAdminSalt",
            hash: "6fADYzT98VWr970cJ2rD/sEmthlRK9Xq71YHrXYZMZM=",
            groups: ["admin", "dm"],
          },
        ],
      };

      await this.upsertFile(USERS_PATH, JSON.stringify(db, null, 2));
      return db;
    }

    const txt = await this.app.vault.read(existing as any);
    return JSON.parse(txt) as UsersDb;
  }

  private async loadUsers(): Promise<UserEntry[]> {
    const db = await this.ensureUsersFile();
    return db.users ?? [];
  }


  private async saveUsers(users: UserEntry[]): Promise<void> {
    const txt = JSON.stringify({ users } as UsersDb, null, 2);
    await this.upsertFile(USERS_PATH, txt);
  }

  private async generateUserReportNote(): Promise<string> {
    const REPORT_PATH = "Admin Area/UserReport.md";

    const users = await this.loadUsers();

    const lines: string[] = [];
    lines.push("---");
    lines.push("dnd_access_groups: [admin]");
    lines.push("dnd_require_auth: true");
    lines.push("generated: true");
    lines.push("---");
    lines.push("");
    lines.push("# User Report");
    lines.push("");
    lines.push(`Updated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("| User | Groups |");
    lines.push("|---|---|");
    for (const u of users) {
      lines.push(`| ${u.name} | ${(u.groups ?? []).join(", ") || "-"} |`);
    }
    lines.push("");

    await this.upsertFile(REPORT_PATH, lines.join("\n"));
    return REPORT_PATH;
  }



  private async verifyPassword(
    userName: string,
    password: string
  ): Promise<boolean> {
    const users = await this.loadUsers();
    const u = users.find((x) => x.name === userName);
    if (!u) return false;
    const candidate = await sha256Base64(`${u.salt}:${password}`);
    return candidate === u.hash;
  }

  private canAccessFile(file: TFile): boolean {
    if (this.isAdmin()) return true;

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return false;

    const requiredGroups: string[] = Array.isArray(fm.dnd_access_groups)
      ? fm.dnd_access_groups
      : [];
    if (requiredGroups.length === 0) return false; // gated-open list is only for gated notes

    const requireAuth: boolean =
      typeof fm.dnd_require_auth === "boolean" ? fm.dnd_require_auth : true;
    if (requireAuth && !this.state.isAuthenticated) return false;

    const userGroups = this.state.currentGroups ?? [];
    return requiredGroups.some((g) => userGroups.includes(g));
  }
}

/* ---------------- Modals ---------------- */

class ButtonUserPickModal extends Modal {
  constructor(
    app: App,
    private users: UserEntry[],
    private done: (u: UserEntry | null) => void
  ) {
    super(app);
  }

  onOpen() {
  const { contentEl } = this;
  contentEl.empty();
  contentEl.createEl("h3", { text: "Select character" });

  if (!this.users.length) {
    contentEl.createEl("p", { text: "No users found." });
  } else {
    for (const u of this.users) {
      const btn = contentEl.createEl("button", { text: u.name });
      btn.addClass("am-modal-btn");
      btn.addEventListener("click", () => {
        this.done(u);
        this.close();
      });
    }
  } // ✅ diese Klammer hat gefehlt

  const cancel = contentEl.createEl("button", { text: "Cancel" });
  cancel.addClass("am-modal-cancel");
  cancel.addEventListener("click", () => {
    this.done(null);
    this.close();
  });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class PasswordModal extends Modal {
  private value = "";
  constructor(app: App, private done: (v: string | null) => void) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Enter password" });

    const input = contentEl.createEl("input", { type: "password" });
    input.focus();
    input.addEventListener("input", () => (this.value = input.value));

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("OK")
          .setCta()
          .onClick(() => {
            this.done(this.value);
            this.close();
          })
      )
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          this.done(null);
          this.close();
        })
      );
  }
  onClose() {
    this.contentEl.empty();
  }
}

class CreateUserModal extends Modal {
  private name = "";
  private password = "";
  private groups = "";

  constructor(
    app: App,
    private done: (v: { name: string; password: string; groups: string } | null) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Create / update user" });

    const nameInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "User name (e.g. Castro)",
    });
    nameInput.addEventListener("input", () => (this.name = nameInput.value));
    nameInput.focus();

    const passInput = contentEl.createEl("input", {
      type: "password",
      placeholder: "Password",
    });
    passInput.addEventListener("input", () => (this.password = passInput.value));

    const groupsInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Groups (comma separated), e.g. party, house_cannith",
    });
    groupsInput.addEventListener("input", () => (this.groups = groupsInput.value));

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.done({ name: this.name, password: this.password, groups: this.groups });
            this.close();
          })
      )
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          this.done(null);
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class SingleLineModal extends Modal {
  private value = "";
  constructor(
    app: App,
    private title: string,
    private placeholder: string,
    private done: (v: string | null) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: this.placeholder,
    });
    input.addEventListener("input", () => (this.value = input.value));
    input.focus();

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("OK")
          .setCta()
          .onClick(() => {
            this.done(this.value.trim() || null);
            this.close();
          })
      )
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          this.done(null);
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class UserPickModal extends FuzzySuggestModal<UserEntry> {
  private hasResolved = false;

  constructor(
    app: App,
    private users: UserEntry[],
    private done: (u: UserEntry | null) => void
  ) {
    super(app);
    this.setPlaceholder("Pick a user…");
  }

  getItems(): UserEntry[] {
    return this.users;
  }

  getItemText(item: UserEntry): string {
    return item.name;
  }

  onChooseItem(item: UserEntry): void {
    if (this.hasResolved) return;
    this.hasResolved = true;
    this.done(item);
    this.close();
  }

  onClose() {
    super.onClose();
    if (this.hasResolved) return;
    this.hasResolved = true;
    this.done(null);
  }
}



class LiveFilePickModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: AuthentificatorPlugin) {
    super(app);
    this.setPlaceholder("Type to search gated notes…");
  }
  getItems(): TFile[] {
    const files = this.plugin.app.vault.getMarkdownFiles();
    return files.filter((f) => (this.plugin as any).canAccessFile(f));
  }
  getItemText(item: TFile): string { return item.path; }
  async onChooseItem(item: TFile): Promise<void> {
    await this.plugin.app.workspace.getLeaf(true).openFile(item);
  }
}

class StatusMenuModal extends Modal {
  constructor(app: App, private plugin: AuthentificatorPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "authentificator" });

    new Setting(contentEl)
      .setName("Select character")
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => {
          this.close();
          (this.plugin.app as AppWithCommands).commands.executeCommandById(            "account-manager:authentificator-select-character"
          );
        })
      );

    new Setting(contentEl)
      .setName("Login (password)")
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => {
          this.close();
          (this.plugin.app as AppWithCommands).commands.executeCommandById(
          "account-manager:authentificator-login"
          );

        })
      );

    new Setting(contentEl)
      .setName("Open gated note…")
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => {
          this.close();
          (this.plugin.app as AppWithCommands).commands.executeCommandById(            "account-manager:authentificator-open-gated-note"
          );
        })
      );


    new Setting(contentEl)
      .setName("Logout")
      .addButton((b) =>
        b.setButtonText("Do it").onClick(() => {
          this.close();
          (this.plugin.app as AppWithCommands).commands.executeCommandById(            "account-manager:authentificator-logout"
          );
        })
      );


    // Admin section
    if ((this.plugin as any).isAdmin()) {
      contentEl.createEl("hr");
      new Setting(contentEl)
        .setName("Admin: Create/Update user")
        .addButton((b) =>
          b.setButtonText("Open").onClick(() => {
            this.close();
            (this.plugin.app as AppWithCommands).commands.executeCommandById(              "account-manager:authentificator-admin-create-update-user"
            );
          })
        );

      new Setting(contentEl)
        .setName("Admin: Toggle group for user")
        .addButton((b) =>
          b.setButtonText("Open").onClick(() => {
            this.close();
            (this.plugin.app as AppWithCommands).commands.executeCommandById(              "account-manager:authentificator-admin-toggle-group"
            );
          })
        );

      new Setting(contentEl)
        .setName("Admin: Toggle group for ALL players")
        .addButton((b) =>
          b.setButtonText("Open").onClick(() => {
            this.close();
            (this.plugin.app as AppWithCommands).commands.executeCommandById(              "account-manager:authentificator-admin-toggle-group-all"
            );
          })
        );

      new Setting(contentEl)
        .setName("Admin: Reset temporary groups")
        .addButton((b) =>
          b.setButtonText("Open").onClick(() => {
            this.close();
            (this.plugin.app as AppWithCommands).commands.executeCommandById(              "account-manager:authentificator-admin-reset-temp-groups"
            );
          })
        );

      new Setting(contentEl)
        .setName("Admin: Who has group?")
        .addButton((b) =>
          b.setButtonText("Open").onClick(() => {
            this.close();
            (this.plugin.app as AppWithCommands).commands.executeCommandById(
            "account-manager:authentificator-admin-who-has-group"
          );

          })
        );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
