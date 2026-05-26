"""Atlas — interfaz CustomTkinter (legacy) y sincronización del módulo Atlas VPN."""

from __future__ import annotations

import shutil
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import customtkinter as ctk
from customtkinter import CTkImage
from PIL import Image

_SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import tunnel_manager as tm

from atlas_vpn import theme
from atlas_vpn.constants import resolve_ssh_username
from atlas_vpn.cf_sync import CfSyncError, sync_to_tunnels_json
from atlas_vpn.pgadmin_launch import launch_pgadmin
from atlas_vpn.poslite_urls import poslite_links_for_site
from atlas_core.paths import PROJECT_ROOT, resolve_logo_path
from atlas_vpn.settings_store import load_settings, save_settings

def _configure_ttk_tree() -> None:
    style = ttk.Style()
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass
    style.configure(
        "Atlas.Treeview",
        background=theme.SURFACE,
        fieldbackground=theme.SURFACE,
        foreground=theme.TEXT,
        rowheight=30,
        font=theme.FONT_SMALL,
        borderwidth=0,
    )
    style.configure(
        "Atlas.Treeview.Heading",
        background=theme.SLATE,
        foreground=theme.TEXT_MUTED,
        font=theme.FONT_SMALL,
        relief="flat",
    )
    style.map(
        "Atlas.Treeview",
        background=[("selected", theme.SLATE_LIGHT)],
        foreground=[("selected", theme.TEXT)],
    )


class MainWindow(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Atlas")
        self.geometry("1100x720")
        self.minsize(640, 440)
        self.configure(fg_color=theme.BG)
        self._config_path = tm.default_config_path()
        self._timer_id: str | None = None
        self._cf_sync_busy = False
        self._configure_job: str | None = None
        self._mid_tree: ctk.CTkFrame | None = None
        self._about_body_labels: list[ctk.CTkLabel] = []
        _configure_ttk_tree()
        self._build()
        self._schedule_refresh()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.bind("<Configure>", self._on_root_configure)

    def _on_root_configure(self, _event: tk.Event) -> None:
        if self._configure_job is not None:
            self.after_cancel(self._configure_job)
        self._configure_job = self.after(120, self._apply_responsive_layout)

    def _apply_responsive_layout(self) -> None:
        self._configure_job = None
        w = max(self.winfo_width(), 400)
        wrap = max(280, int(w * 0.85))
        if hasattr(self, "_cf_blurb") and self._cf_blurb.winfo_exists():
            self._cf_blurb.configure(wraplength=wrap)
        if hasattr(self, "_cf_zone_hint") and self._cf_zone_hint.winfo_exists():
            self._cf_zone_hint.configure(wraplength=wrap)
        for lbl in self._about_body_labels:
            try:
                if lbl.winfo_exists():
                    lbl.configure(wraplength=min(720, wrap))
            except tk.TclError:
                pass
        self._resize_tree_columns()

    def _resize_tree_columns(self) -> None:
        if self._mid_tree is None or not self._mid_tree.winfo_exists():
            return
        try:
            tw = self._mid_tree.winfo_width()
        except tk.TclError:
            return
        if tw < 200:
            return
        inner = max(tw - 24, 200)
        self.tree.column("site", width=int(inner * 0.14), minwidth=72, stretch=True)
        self.tree.column("ssh_ep", width=int(inner * 0.24), minwidth=100, stretch=True)
        self.tree.column("db_ep", width=int(inner * 0.24), minwidth=100, stretch=True)
        self.tree.column("ssh_st", width=int(inner * 0.17), minwidth=72, stretch=True)
        self.tree.column("db_st", width=int(inner * 0.17), minwidth=72, stretch=True)

    def _build(self) -> None:
        head = ctk.CTkFrame(self, fg_color=theme.BG, corner_radius=0, height=76)
        head.pack(fill=tk.X)
        head.pack_propagate(False)
        sep = ctk.CTkFrame(self, fg_color=theme.BORDER, height=1, corner_radius=0)
        sep.pack(fill=tk.X)

        inner = ctk.CTkFrame(head, fg_color="transparent")
        inner.pack(fill=tk.BOTH, expand=True, padx=20, pady=(10, 10))
        head_sync = ctk.CTkFrame(inner, fg_color="transparent")
        head_sync.pack(side=tk.RIGHT, padx=(10, 0), pady=(4, 0))
        ctk.CTkButton(
            head_sync,
            text="Sincronizar CF",
            width=124,
            height=34,
            corner_radius=8,
            fg_color=theme.ACCENT,
            hover_color=theme.ACCENT_HOVER,
            font=theme.FONT_SMALL,
            command=self._sync_cf_async,
        ).pack(anchor="e")
        ctk.CTkLabel(
            head_sync,
            text="Siempre visible",
            font=theme.FONT_SMALL,
            text_color=theme.TEXT_SUBTLE,
        ).pack(anchor="e", pady=(2, 0))
        logo_path = resolve_logo_path()
        if logo_path:
            pil = Image.open(logo_path).convert("RGBA")
            tw = 128
            th = max(24, int(pil.size[1] * tw / pil.size[0]))
            th = min(th, 48)
            pil = pil.resize((tw, th), Image.Resampling.LANCZOS)
            self._logo_ctk = CTkImage(light_image=pil, dark_image=pil, size=(tw, th))
            ctk.CTkLabel(inner, image=self._logo_ctk, text="", fg_color="transparent").pack(
                side=tk.LEFT, padx=(0, 14)
            )
        tx = ctk.CTkFrame(inner, fg_color="transparent")
        tx.pack(side=tk.LEFT, fill=tk.Y)
        ctk.CTkLabel(
            tx,
            text="Atlas",
            font=theme.FONT_TITLE,
            text_color=theme.TEXT,
            fg_color="transparent",
        ).pack(anchor="w")
        ctk.CTkLabel(
            tx,
            text="SSH y bases de datos vía Cloudflare Access TCP",
            font=theme.FONT_SUB,
            text_color=theme.TEXT_MUTED,
            fg_color="transparent",
        ).pack(anchor="w")

        tabs = ctk.CTkTabview(
            self,
            fg_color=theme.BG,
            segmented_button_fg_color=theme.SURFACE_ELEVATED,
            segmented_button_selected_color=theme.ACCENT,
            segmented_button_selected_hover_color=theme.ACCENT_HOVER,
            segmented_button_unselected_color=theme.SLATE,
            segmented_button_unselected_hover_color=theme.SLATE_LIGHT,
            corner_radius=12,
            border_width=1,
            border_color=theme.BORDER,
        )
        tabs.pack(fill=tk.BOTH, expand=True, padx=14, pady=(10, 14))
        try:
            tabs._segmented_button.configure(font=theme.FONT_UI, height=34)
        except Exception:
            pass
        tabs.add("Conexiones")
        tabs.add("Poslite")
        tabs.add("Cloudflare")
        tabs.add("Acerca de")

        self._build_connections_tab(tabs.tab("Conexiones"))
        self._build_poslite_tab(tabs.tab("Poslite"))
        self._build_cloudflare_tab(tabs.tab("Cloudflare"))
        self._build_about_tab(tabs.tab("Acerca de"))
        self.after(200, self._apply_responsive_layout)
        self.after(1500, self._auto_sync_cloudflare_on_start)

    def _build_connections_tab(self, parent: ctk.CTkFrame) -> None:
        parent.grid_columnconfigure(0, weight=1)
        parent.grid_rowconfigure(1, weight=2)
        parent.grid_rowconfigure(3, weight=1)

        top = ctk.CTkFrame(parent, fg_color="transparent")
        top.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 6))
        top.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(top, text="Configuración", text_color=theme.TEXT_MUTED, font=theme.FONT_SMALL).grid(
            row=0, column=0, sticky="w"
        )
        self._lbl_path = ctk.CTkLabel(
            top,
            text=str(self._config_path),
            text_color=theme.TEXT,
            font=theme.FONT_MONO_SMALL,
            anchor="w",
            fg_color=theme.SURFACE,
            corner_radius=8,
            padx=10,
            pady=6,
        )
        self._lbl_path.grid(row=0, column=1, sticky="ew", padx=(8, 8))
        btns = ctk.CTkFrame(top, fg_color="transparent")
        btns.grid(row=0, column=2, sticky="e")
        for txt, cmd, col in (
            ("Abrir…", self._browse_config, theme.SLATE_LIGHT),
            ("Recargar", self._reload_config, theme.SLATE_LIGHT),
            ("Plantilla", self._init_config, theme.SLATE_LIGHT),
        ):
            ctk.CTkButton(
                btns,
                text=txt,
                width=88,
                height=32,
                corner_radius=8,
                fg_color=col,
                hover_color=theme.SLATE,
                font=theme.FONT_SMALL,
                command=cmd,
            ).pack(side=tk.LEFT, padx=3)

        self._mid_tree = ctk.CTkFrame(parent, fg_color=theme.SURFACE, corner_radius=12, border_width=1, border_color=theme.BORDER)
        self._mid_tree.grid(row=1, column=0, sticky="nsew", padx=10, pady=6)
        self._mid_tree.grid_columnconfigure(0, weight=1)
        self._mid_tree.grid_rowconfigure(0, weight=1)

        cols = ("site", "ssh_ep", "db_ep", "ssh_st", "db_st")
        self.tree = ttk.Treeview(
            self._mid_tree,
            columns=cols,
            show="headings",
            height=10,
            selectmode="browse",
            style="Atlas.Treeview",
        )
        headings = {
            "site": "Sitio",
            "ssh_ep": "SSH (hostname → puerto local)",
            "db_ep": "BD (hostname → puerto local)",
            "ssh_st": "SSH",
            "db_st": "BD",
        }
        for c in cols:
            self.tree.heading(c, text=headings[c])
            self.tree.column(c, width=120, stretch=True)
        sy = ttk.Scrollbar(self._mid_tree, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=sy.set)
        self.tree.grid(row=0, column=0, sticky="nsew", padx=6, pady=6)
        sy.grid(row=0, column=1, sticky="ns", pady=6)

        btn_row = ctk.CTkFrame(parent, fg_color="transparent")
        btn_row.grid(row=2, column=0, sticky="ew", padx=10, pady=6)
        for label, svc, color, hover in (
            ("Iniciar SSH", "ssh", theme.NAVY, theme.NAVY_HOVER),
            ("Iniciar BD", "db", theme.NAVY, theme.NAVY_HOVER),
            ("Ambos", "both", theme.NAVY, theme.NAVY_HOVER),
        ):
            ctk.CTkButton(
                btn_row,
                text=label,
                width=118,
                height=36,
                corner_radius=8,
                fg_color=color,
                hover_color=hover,
                font=theme.FONT_UI,
                command=lambda s=svc: self._start_async(s),
            ).pack(side=tk.LEFT, padx=4)
        ctk.CTkButton(
            btn_row,
            text="Terminal SSH",
            width=132,
            height=36,
            corner_radius=8,
            fg_color=theme.ACCENT,
            hover_color=theme.ACCENT_HOVER,
            font=theme.FONT_UI,
            command=self._open_ssh_terminal,
        ).pack(side=tk.LEFT, padx=(12, 4))
        ctk.CTkButton(
            btn_row,
            text="PgAdmin",
            width=118,
            height=36,
            corner_radius=8,
            fg_color="#0284C7",
            hover_color="#0369A1",
            font=theme.FONT_UI,
            command=self._open_pgadmin,
        ).pack(side=tk.LEFT, padx=4)
        ctk.CTkButton(
            btn_row,
            text="Detener sitio",
            width=118,
            height=36,
            corner_radius=8,
            fg_color=theme.SLATE_LIGHT,
            hover_color=theme.SLATE,
            font=theme.FONT_UI,
            command=self._stop_site,
        ).pack(side=tk.LEFT, padx=4)
        ctk.CTkButton(
            btn_row,
            text="Detener todo",
            width=110,
            height=36,
            corner_radius=8,
            fg_color=theme.DANGER,
            hover_color="#DA3633",
            font=theme.FONT_UI,
            command=self._stop_all,
        ).pack(side=tk.LEFT, padx=4)

        log_fr = ctk.CTkFrame(parent, fg_color=theme.SURFACE, corner_radius=12, border_width=1, border_color=theme.BORDER)
        log_fr.grid(row=3, column=0, sticky="nsew", padx=10, pady=(0, 10))
        log_fr.grid_columnconfigure(0, weight=1)
        log_fr.grid_rowconfigure(0, weight=1)
        self.log = tk.Text(
            log_fr,
            height=6,
            state=tk.DISABLED,
            wrap=tk.WORD,
            font=theme.FONT_MONO_SMALL,
            bg=theme.SURFACE_ELEVATED,
            fg=theme.TEXT,
            insertbackground=theme.TEXT,
            highlightthickness=0,
            borderwidth=0,
        )
        ls = ttk.Scrollbar(log_fr, command=self.log.yview)
        self.log.configure(yscrollcommand=ls.set)
        self.log.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)
        ls.grid(row=0, column=1, sticky="ns", pady=8)

        if tm.load_config_optional(self._config_path) is None:
            self._log("No hay tunnels.json. Sincroniza desde Cloudflare o crea una plantilla.")

    def _build_cloudflare_tab(self, parent: ctk.CTkFrame) -> None:
        s = load_settings()
        wrap = ctk.CTkScrollableFrame(parent, fg_color="transparent")
        wrap.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        ctk.CTkLabel(
            wrap,
            text="Sincronización",
            font=theme.FONT_TITLE,
            text_color=theme.TEXT,
        ).pack(anchor="w", pady=(0, 4))
        self._cf_blurb = ctk.CTkLabel(
            wrap,
            text="Cuenta y dominio Cloudflare.",
            font=theme.FONT_SMALL,
            text_color=theme.TEXT_MUTED,
            wraplength=640,
            justify="left",
        )
        self._cf_blurb.pack(anchor="w", pady=(0, 16))

        ctk.CTkLabel(wrap, text="Account ID", font=theme.FONT_UI, text_color=theme.TEXT).pack(anchor="w")
        self._cf_account = ctk.CTkEntry(
            wrap,
            width=400,
            height=38,
            corner_radius=8,
            placeholder_text="UUID de la cuenta (32 hex)",
            fg_color=theme.SURFACE,
            border_color=theme.BORDER,
        )
        self._cf_account.insert(0, s["account_id"])
        self._cf_account.pack(anchor="w", fill=tk.X, pady=(4, 12))

        ctk.CTkLabel(
            wrap,
            text="API Token",
            font=theme.FONT_UI,
            text_color=theme.TEXT,
        ).pack(anchor="w")
        self._cf_token = ctk.CTkEntry(
            wrap,
            width=400,
            height=38,
            corner_radius=8,
            placeholder_text="Token de API (no uses la Global API Key)",
            show="*",
            fg_color=theme.SURFACE,
            border_color=theme.BORDER,
        )
        self._cf_token.insert(0, s["api_token"])
        self._cf_token.pack(anchor="w", fill=tk.X, pady=(4, 4))
        ctk.CTkLabel(
            wrap,
            text="Permisos típicos: Zero Trust / Access lectura, Cloudflare Tunnel lectura; con Zone ID también DNS lectura.",
            font=theme.FONT_SMALL,
            text_color=theme.TEXT_SUBTLE,
            wraplength=640,
            justify="left",
        ).pack(anchor="w", pady=(0, 12))

        ctk.CTkLabel(wrap, text="Sufijo de dominio", font=theme.FONT_UI, text_color=theme.TEXT).pack(anchor="w")
        self._cf_suffix = ctk.CTkEntry(
            wrap,
            width=320,
            height=38,
            corner_radius=8,
            fg_color=theme.SURFACE,
            border_color=theme.BORDER,
        )
        self._cf_suffix.insert(0, s["domain_suffix"])
        self._cf_suffix.pack(anchor="w", fill=tk.X, pady=(4, 12))

        ctk.CTkLabel(wrap, text="Zone ID (opcional)", font=theme.FONT_UI, text_color=theme.TEXT).pack(anchor="w")
        self._cf_zone = ctk.CTkEntry(
            wrap,
            width=400,
            height=38,
            corner_radius=8,
            placeholder_text="Overview de la zona — 32 hex",
            fg_color=theme.SURFACE,
            border_color=theme.BORDER,
        )
        self._cf_zone.insert(0, s.get("zone_id", ""))
        self._cf_zone.pack(anchor="w", fill=tk.X, pady=(4, 4))
        self._cf_zone_hint = ctk.CTkLabel(
            wrap,
            text="Si lo rellenas: Access por zona y lectura de CNAME hacia túneles en esa zona.",
            font=theme.FONT_SMALL,
            text_color=theme.TEXT_MUTED,
            wraplength=640,
            justify="left",
        )
        self._cf_zone_hint.pack(anchor="w", pady=(0, 12))

        row = ctk.CTkFrame(wrap, fg_color="transparent")
        row.pack(anchor="w", pady=(4, 8))
        self._btn_cf_save = ctk.CTkButton(
            row,
            text="Guardar",
            width=120,
            height=36,
            corner_radius=8,
            fg_color=theme.SLATE_LIGHT,
            hover_color=theme.SLATE,
            font=theme.FONT_UI,
            command=self._save_cf_settings,
        )
        self._btn_cf_save.pack(side=tk.LEFT, padx=(0, 10))
        self._btn_cf_sync = ctk.CTkButton(
            row,
            text="Sincronizar",
            width=140,
            height=36,
            corner_radius=8,
            fg_color=theme.ACCENT,
            hover_color=theme.ACCENT_HOVER,
            font=theme.FONT_UI,
            command=self._sync_cf_async,
        )
        self._btn_cf_sync.pack(side=tk.LEFT)

        self._cf_progress = ctk.CTkProgressBar(
            wrap,
            mode="indeterminate",
            width=260,
            height=6,
            progress_color=theme.ACCENT,
            fg_color=theme.SLATE,
        )

        self._cf_sync_status = ctk.CTkLabel(
            wrap,
            text="",
            font=theme.FONT_UI,
            text_color=theme.SUCCESS,
            anchor="w",
        )

    def _build_poslite_tab(self, parent: ctk.CTkFrame) -> None:
        parent.grid_columnconfigure(0, weight=1)
        parent.grid_rowconfigure(1, weight=1)
        ctk.CTkLabel(
            parent,
            text="Accesos al portal Poslite por tienda.",
            font=theme.FONT_SMALL,
            text_color=theme.TEXT_MUTED,
            wraplength=900,
            justify="left",
        ).grid(row=0, column=0, sticky="ew", padx=12, pady=(12, 6))
        sc = ctk.CTkScrollableFrame(parent, fg_color="transparent")
        sc.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 10))
        self._poslite_scroll = sc
        self._refresh_poslite_tab()

    def _refresh_poslite_tab(self) -> None:
        sc = getattr(self, "_poslite_scroll", None)
        if sc is None:
            return
        try:
            if not sc.winfo_exists():
                return
        except tk.TclError:
            return
        for w in sc.winfo_children():
            w.destroy()
        suf = (load_settings().get("domain_suffix") or "asptienda.com").strip() or "asptienda.com"
        cfg = tm.load_config_optional(self._config_path)
        if not cfg:
            ctk.CTkLabel(
                sc,
                text="No hay tunnels.json. Sincroniza desde Cloudflare o crea una plantilla.",
                font=theme.FONT_SMALL,
                text_color=theme.TEXT_MUTED,
            ).pack(anchor="w", padx=8, pady=8)
            return
        root_pd = (
            cfg.get("poslite_defaults") if isinstance(cfg.get("poslite_defaults"), dict) else None
        )
        sites_dict = cfg.get("sites") or {}
        names = sorted(sites_dict.keys(), key=str.lower)
        if not names:
            ctk.CTkLabel(
                sc,
                text="No hay sitios en tunnels.json.",
                font=theme.FONT_SMALL,
                text_color=theme.TEXT_MUTED,
            ).pack(anchor="w", padx=8, pady=8)
            return
        for name in names:
            raw = sites_dict.get(name) or {}
            entry = raw if isinstance(raw, dict) else {}
            box = ctk.CTkFrame(
                sc,
                fg_color=theme.SURFACE,
                corner_radius=10,
                border_width=1,
                border_color=theme.BORDER,
            )
            box.pack(fill=tk.X, pady=6, padx=4)
            ctk.CTkLabel(
                box,
                text=name,
                font=theme.FONT_UI,
                text_color=theme.TEXT,
            ).pack(anchor="w", padx=12, pady=(10, 4))
            row = ctk.CTkFrame(box, fg_color="transparent")
            row.pack(fill=tk.X, padx=8, pady=(0, 10))
            for link in poslite_links_for_site(name, suf, entry, root_pd):
                url = str(link.get("url", ""))
                suf_lab = link.get("suffix")
                if isinstance(suf_lab, str) and suf_lab.strip():
                    btn_text = suf_lab.strip()[:22]
                elif link.get("port") is not None:
                    btn_text = f":{link['port']}"
                else:
                    btn_text = "·"
                ctk.CTkButton(
                    row,
                    text=btn_text,
                    width=88,
                    height=32,
                    corner_radius=8,
                    fg_color=theme.SLATE_LIGHT,
                    hover_color=theme.SLATE,
                    font=theme.FONT_SMALL,
                    command=lambda u=url: webbrowser.open(u),
                ).pack(side=tk.LEFT, padx=4, pady=4)

    def _set_cf_sync_status(self, ok: bool | None, message: str = "") -> None:
        """ok True = check verde, False = error corto, None = ocultar."""
        if ok is None:
            self._cf_sync_status.pack_forget()
            self._cf_sync_status.configure(text="")
            return
        if ok:
            self._cf_sync_status.configure(
                text=f"✓  {message or 'Sincronizado correctamente'}",
                text_color=theme.SUCCESS,
            )
        else:
            self._cf_sync_status.configure(text=message, text_color=theme.DANGER)
        self._cf_sync_status.pack(anchor="w", pady=(10, 0))

    def _set_cf_sync_busy(self, busy: bool) -> None:
        if busy:
            self._set_cf_sync_status(None)
            self._btn_cf_sync.configure(text="Sincronizando…", state="disabled")
            self._btn_cf_save.configure(state="disabled")
            self._cf_account.configure(state="disabled")
            self._cf_token.configure(state="disabled")
            self._cf_suffix.configure(state="disabled")
            self._cf_zone.configure(state="disabled")
            self._cf_progress.pack(anchor="w", pady=(12, 0))
            self._cf_progress.start()
        else:
            self._cf_progress.stop()
            self._cf_progress.pack_forget()
            self._btn_cf_sync.configure(text="Sincronizar", state="normal")
            self._btn_cf_save.configure(state="normal")
            self._cf_account.configure(state="normal")
            self._cf_token.configure(state="normal")
            self._cf_suffix.configure(state="normal")
            self._cf_zone.configure(state="normal")

    def _build_about_tab(self, parent: ctk.CTkFrame) -> None:
        outer = ctk.CTkScrollableFrame(parent, fg_color="transparent")
        outer.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)
        self._about_body_labels.clear()

        def card(title: str, body: str) -> None:
            box = ctk.CTkFrame(
                outer,
                fg_color=theme.SURFACE,
                corner_radius=12,
                border_width=1,
                border_color=theme.BORDER,
            )
            box.pack(fill=tk.X, pady=(0, 12))
            ctk.CTkLabel(
                box,
                text=title,
                font=theme.FONT_UI,
                text_color=theme.TEXT,
                anchor="w",
            ).pack(anchor="w", padx=16, pady=(14, 6))
            body_lbl = ctk.CTkLabel(
                box,
                text=body,
                font=theme.FONT_SMALL,
                text_color=theme.TEXT_MUTED,
                wraplength=680,
                justify="left",
                anchor="w",
            )
            body_lbl.pack(anchor="w", padx=16, pady=(0, 14))
            self._about_body_labels.append(body_lbl)

        card(
            "Módulo Atlas VPN",
            "Cliente de escritorio para levantar `cloudflared access tcp` hacia tus hostnames "
            "de SSH y base de datos publicados tras Cloudflare Access. La sincronización rellena "
            "`scripts/tunnels.json` desde la API de Cloudflare (Access, ingress de túneles y DNS opcional).",
        )
        card(
            "Requisitos",
            "Tener `cloudflared` en el PATH, completar el login de Access en el navegador cuando "
            "lo pida el túnel, y mantener los puertos locales libres según tu JSON. "
            "El botón «Terminal SSH» abre una consola con el usuario fijo «admin» (ajustable en código si cambiáis de convención). "
            "«PgAdmin» abre pgAdmin 4 si está instalado (Windows: carpeta típica Program Files\\pgAdmin 4\\runtime)."
        )
        card(
            "Proyecto y logos",
            f"Raíz del proyecto:\n{PROJECT_ROOT}\n\nLogos de marca: ui/public/branding/ (PNG con transparencia recomendado).",
        )

    def _save_cf_settings(self) -> None:
        save_settings(
            self._cf_account.get(),
            self._cf_token.get(),
            self._cf_suffix.get(),
            self._cf_zone.get(),
        )
        messagebox.showinfo("Atlas", "Ajustes guardados en .atlas/settings.json")

    def _sync_cf_async(self) -> None:
        self._start_cf_sync(dialog_on_error=True, use_disk_settings=False)

    def _auto_sync_cloudflare_on_start(self) -> None:
        s = load_settings()
        if not (s.get("account_id") or "").strip() or not (s.get("api_token") or "").strip():
            return
        self._start_cf_sync(dialog_on_error=False, use_disk_settings=True)

    def _start_cf_sync(self, *, dialog_on_error: bool, use_disk_settings: bool) -> None:
        if self._cf_sync_busy:
            return
        if use_disk_settings:
            s = load_settings()
            acc = (s.get("account_id") or "").strip()
            tok = (s.get("api_token") or "").strip()
            suf = (s.get("domain_suffix") or "asptienda.com").strip() or "asptienda.com"
            zone = (s.get("zone_id") or "").strip()
            if not acc or not tok:
                return
        else:
            acc = self._cf_account.get().strip()
            tok = self._cf_token.get().strip()
            suf = self._cf_suffix.get().strip() or "asptienda.com"
            zone = self._cf_zone.get().strip()
            if not acc or not tok:
                messagebox.showwarning("Atlas", "Account ID y API Token son obligatorios.")
                return
            save_settings(acc, tok, suf, zone)
        self._cf_sync_busy = True
        self._set_cf_sync_busy(True)
        self._log(
            "Sincronización automática con Cloudflare…"
            if use_disk_settings
            else "Sincronizando con Cloudflare…"
        )

        def work() -> None:
            try:
                n, msg = sync_to_tunnels_json(
                    acc,
                    tok,
                    suf,
                    self._config_path,
                    zone_id=zone,
                )
                snap: tuple[bool, str, str] = (True, msg, f"{n} sitios actualizados")
            except CfSyncError as e:
                snap = (False, str(e), "")
            except Exception as e:
                snap = (False, f"Error inesperado: {e!r}", "")

            def done() -> None:
                try:
                    ok, text, short = snap
                    if ok:
                        self._log(text)
                        self._set_cf_sync_status(True, short or "Sincronizado correctamente")
                    else:
                        self._log(f"ERROR sincronización: {text}")
                        self._set_cf_sync_status(False, "Error al sincronizar (ver registro)")
                        if dialog_on_error:
                            messagebox.showerror("Atlas", text)
                    self._config_path = tm.default_config_path()
                    self._lbl_path.configure(text=str(self._config_path))
                    self._fill_tree()
                    self._refresh_poslite_tab()
                finally:
                    self._cf_sync_busy = False
                    self._set_cf_sync_busy(False)

            self.after(0, done)

        threading.Thread(target=work, daemon=True).start()

    def _log(self, text: str) -> None:
        self.log.configure(state=tk.NORMAL)
        self.log.insert(tk.END, text + "\n")
        self.log.see(tk.END)
        self.log.configure(state=tk.DISABLED)

    def _browse_config(self) -> None:
        p = filedialog.askopenfilename(
            title="JSON de túneles",
            initialdir=str(self._config_path.parent),
            filetypes=[("JSON", "*.json"), ("Todos", "*.*")],
        )
        if p:
            self._config_path = Path(p)
            self._lbl_path.configure(text=str(self._config_path))
            self._reload_config()

    def _init_config(self) -> None:
        _ok, msg = tm.init_config_from_example()
        self._log(msg)
        self._config_path = tm.default_config_path()
        self._lbl_path.configure(text=str(self._config_path))
        self._reload_config()

    def _reload_config(self) -> None:
        self._fill_tree()
        self.after_idle(self._resize_tree_columns)

    def _proc_for_site_label(self, site: str, label: str) -> dict | None:
        state = tm.read_state()
        for row in state.get("processes", []):
            if row.get("site") == site and row.get("label") == label:
                return row
        return None

    def _state_label(self, row: dict | None) -> str:
        if not row:
            return "—"
        pid = int(row["pid"])
        return "Activo" if tm.pid_alive(pid) else "Muerto"

    def _fill_tree(self) -> None:
        for i in self.tree.get_children():
            self.tree.delete(i)
        cfg = tm.load_config_optional(self._config_path)
        if not cfg:
            self._refresh_poslite_tab()
            return
        sites = cfg.get("sites") or {}
        for name in sorted(sites.keys()):
            e = sites[name]
            ssh = e.get("ssh") or {}
            db = e.get("db") or {}
            ssh_ep = (
                f"{ssh.get('hostname', '')} → :{ssh.get('local_port', '')}" if ssh else "—"
            )
            db_ep = f"{db.get('hostname', '')} → :{db.get('local_port', '')}" if db else "—"
            pr_ssh = self._proc_for_site_label(name, "ssh")
            pr_db = self._proc_for_site_label(name, "db")
            self.tree.insert(
                "",
                tk.END,
                iid=name,
                values=(name, ssh_ep, db_ep, self._state_label(pr_ssh), self._state_label(pr_db)),
            )
        self._refresh_poslite_tab()

    def _selected_site(self) -> str | None:
        sel = self.tree.selection()
        return str(sel[0]) if sel else None

    def _open_ssh_terminal(self) -> None:
        site = self._selected_site()
        if not site:
            messagebox.showwarning("Atlas", "Selecciona un sitio en la tabla.")
            return
        cfg = tm.load_config_optional(self._config_path)
        if not cfg:
            messagebox.showwarning("Atlas", "No hay configuración cargada.")
            return
        entry = (cfg.get("sites") or {}).get(site) or {}
        ssh = entry.get("ssh")
        if not isinstance(ssh, dict) or ssh.get("local_port") in (None, ""):
            messagebox.showwarning("Atlas", "Este sitio no define SSH o falta el puerto local.")
            return
        try:
            port = int(ssh["local_port"])
        except (TypeError, ValueError):
            messagebox.showerror("Atlas", "Puerto SSH inválido en tunnels.json.")
            return
        user = resolve_ssh_username(ssh)
        try:
            if sys.platform == "win32":
                wt = shutil.which("wt")
                if wt:
                    subprocess.Popen(
                        [
                            wt,
                            "new-tab",
                            "--title",
                            f"SSH {site}",
                            "ssh",
                            f"{user}@localhost",
                            "-p",
                            str(port),
                        ],
                        cwd=str(Path.home()),
                    )
                else:
                    creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
                    subprocess.Popen(
                        ["ssh", f"{user}@localhost", "-p", str(port)],
                        creationflags=creationflags,
                    )
            elif sys.platform == "darwin":
                cmd = f"ssh {user}@localhost -p {port}"
                subprocess.Popen(["osascript", "-e", f'tell app "Terminal" to do script "{cmd}"'])
            else:
                if shutil.which("gnome-terminal"):
                    subprocess.Popen(
                        ["gnome-terminal", "--", "ssh", f"{user}@localhost", "-p", str(port)]
                    )
                elif shutil.which("konsole"):
                    subprocess.Popen(
                        ["konsole", "-e", f"ssh {user}@localhost -p {port}"]
                    )
                elif shutil.which("x-terminal-emulator"):
                    subprocess.Popen(
                        ["x-terminal-emulator", "-e", f"ssh {user}@localhost -p {port}"]
                    )
                else:
                    messagebox.showinfo(
                        "Atlas",
                        f"No se encontró terminal gráfica. Ejecuta:\nssh {user}@localhost -p {port}",
                    )
                    return
        except OSError as e:
            messagebox.showerror("Atlas", f"No se pudo abrir la terminal: {e}")
            return
        self._log(f"Terminal SSH: {user}@localhost -p {port} («{site}»)")

    def _open_pgadmin(self) -> None:
        site = self._selected_site()
        ok, msg = launch_pgadmin()
        if not ok:
            messagebox.showerror("Atlas", msg)
            return
        self._log(f"PgAdmin: {msg}")
        if site:
            cfg = tm.load_config_optional(self._config_path)
            if cfg:
                entry = (cfg.get("sites") or {}).get(site) or {}
                db = entry.get("db")
                if isinstance(db, dict) and db.get("local_port") not in (None, ""):
                    try:
                        port = int(db["local_port"])
                    except (TypeError, ValueError):
                        pass
                    else:
                        self._log(
                            f"Sugerencia BD «{site}»: host 127.0.0.1, puerto {port} "
                            "(con túnel BD activo)."
                        )

    def _start_async(self, services: str) -> None:
        site = self._selected_site()
        if not site:
            messagebox.showwarning("Atlas", "Selecciona un sitio en la tabla.")
            return

        def work() -> None:
            _ok, lines = tm.start_site_services(site, services, self._config_path)
            snapshot = list(lines)

            def done() -> None:
                for ln in snapshot:
                    self._log(ln)
                self._fill_tree()

            self.after(0, done)

        self._log(f"Iniciando ({services}) para «{site}»…")
        threading.Thread(target=work, daemon=True).start()

    def _stop_site(self) -> None:
        site = self._selected_site()
        if not site:
            messagebox.showwarning("Atlas", "Selecciona un sitio.")
            return
        for ln in tm.stop_tunnels(site):
            self._log(ln)
        self._fill_tree()

    def _stop_all(self) -> None:
        if not messagebox.askyesno(
            "Atlas", "¿Detener todos los túneles registrados en este equipo?"
        ):
            return
        for ln in tm.stop_tunnels(None):
            self._log(ln)
        self._fill_tree()

    def _schedule_refresh(self) -> None:
        self._fill_tree()
        self._timer_id = self.after(2500, self._schedule_refresh)

    def _on_close(self) -> None:
        if self._timer_id is not None:
            self.after_cancel(self._timer_id)
        if self._configure_job is not None:
            self.after_cancel(self._configure_job)
        self.destroy()


def run_app() -> None:
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")
    app = MainWindow()
    app.mainloop()


if __name__ == "__main__":
    run_app()
