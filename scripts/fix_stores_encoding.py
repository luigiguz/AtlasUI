#!/usr/bin/env python3
"""Restore AtlasStoresView.tsx from a good git revision and re-apply request-view extraction."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TARGET = REPO / "ui" / "src" / "views" / "AtlasStoresView.tsx"
GOOD_COMMIT = "2ad941f"


def git_show(commit: str, path: str) -> str:
    raw = subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=REPO)
    return raw.decode("utf-8")


def main() -> None:
    text = git_show(GOOD_COMMIT, "ui/src/views/AtlasStoresView.tsx")

    # --- imports ---
    text = text.replace(
        'import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Eye, GitBranch, History, Loader2, Plus, RefreshCw, Save, Search, Server, Store, Trash2, Upload, X } from "lucide-react";',
        'import { AlertTriangle, ChevronLeft, ChevronRight, GitBranch, Loader2, Plus, RefreshCw, Save, Search, Server, Store, Trash2, Upload, X } from "lucide-react";',
    )
    text = text.replace(
        'import { AtlasModalShell } from "../components/AtlasModalFrame";\nimport { AtlasPromptDialog } from "../components/AtlasPromptDialog";',
        'import { pulseAtlasNotifications } from "../components/AtlasNotifications";\nimport { AtlasModalShell } from "../components/AtlasModalFrame";\nimport { PublishChangeSummary, STORE_FLEET_PUBLISH_SUCCESS } from "../storeRequestUi";',
    )
    text = re.sub(
        r"import type \{\n  StoreChangeRequest,\n  StoreChangeRequestsResponse,\n  ",
        "import type {\n  ",
        text,
        count=1,
    )
    text = re.sub(
        r"\} from \"\.\./storeTypes\";\nimport \{\n  STORE_REQUESTS_OPEN_EVENT,[\s\S]*?\} from \"\.\./storeRequestsNav\";\n",
        '} from "../storeTypes";\n',
        text,
        count=1,
    )

    # --- remove request-only helpers (keep computeStoreChangeLines + PublishChangeSummary import) ---
    text = re.sub(
        r"type RequestsPanelTab = StoreRequestsPanelTab;\n\n"
        r"type HistoryStatusFilter = \"all\" \| \"approved\" \| \"rejected\" \| \"cancelled\";\n\n"
        r"function requestStatusLabel[\s\S]*?function formatRequestWhen[\s\S]*?\}\n\n",
        "",
        text,
        count=1,
    )
    text = re.sub(
        r"\nfunction PublishChangeSummary\(\{ lines \}: \{ lines: string\[\] \}\) \{[\s\S]*?\}\n\nexport function AtlasStoresView",
        "\n\nexport function AtlasStoresView",
        text,
        count=1,
    )
    text = re.sub(
        r"\nconst STORE_FLEET_PUBLISH_SUCCESS = \{[\s\S]*?\} as const;\n",
        "\n",
        text,
        count=1,
    )

    # --- remove request state block ---
    text = re.sub(
        r"\n  const \[changeRequests[\s\S]*?  const \[requestActionBusy, setRequestActionBusy\] = useState\(false\);\n",
        "\n",
        text,
        count=1,
    )

    # --- remove request loaders / effects / handlers ---
    for pattern in [
        r"\n  const loadChangeRequests = useCallback\([\s\S]*?\}, \[canEdit, canApprove\]\);\n",
        r"\n  const loadHistoryRequests = useCallback\([\s\S]*?\}, \[canEdit, canApprove, historyStatusFilter, historySearchDebounced\]\);\n",
        r"\n  const refreshAllRequests = useCallback\([\s\S]*?\}, \[loadChangeRequests, loadHistoryRequests\]\);\n",
        r"\n  useEffect\(\(\) => \{\n    const t = window\.setTimeout\(\(\) => setHistorySearchDebounced\(historySearch\), 300\);\n[\s\S]*?\}, \[historySearch\]\);\n",
        r"\n  useEffect\(\(\) => \{\n    if \(requestsModalOpen[\s\S]*?\}, \[requestsModalOpen, requestsPanelTab, loadHistoryRequests, canEdit, canApprove\]\);\n",
        r"\n  useEffect\(\(\) => \{\n    if \(requestsModalOpen[\s\S]*?\}, \[requestsModalOpen, requestsPanelTab, loadChangeRequests, canEdit, canApprove\]\);\n",
        r"\n  useEffect\(\(\) => \{\n    if \(approveConfirmId === null\)[\s\S]*?\}, \[approveConfirmId\]\);\n",
        r"\n  async function openRequestDetail\(requestId: number\) \{[\s\S]*?\}\n\n  function closeRequestDetail\(\) \{[\s\S]*?\}\n",
        r"\n  useEffect\(\(\) => \{\n    const onOpenRequests = \(ev: Event\) => \{[\s\S]*?\}, \[\]\);\n",
        r"\n  async function onApproveRequest\(requestId: number\) \{[\s\S]*?\}\n\n  async function onRejectRequest\(requestId: number, note: string\) \{[\s\S]*?\}\n\n  async function onCancelRequest\(requestId: number\) \{[\s\S]*?\}\n",
    ]:
        text = re.sub(pattern, "\n", text, count=1)

    text = text.replace("        void loadChangeRequests();\n", "")
    text = text.replace("      void loadChangeRequests();\n", "")
    text = text.replace("  }, [loadGitStatus, loadChangeRequests]);", "  }, [loadGitStatus]);")
    text = text.replace("        await refreshAllRequests();\n", "        pulseAtlasNotifications();\n")

    # --- remove inline requests panel in list view ---
    text = re.sub(
        r"\n      \{canApprove \|\| canEdit \? \(\n        <div className=\"rounded-xl border border-cf-line/70[\s\S]*?\) : null\}\n",
        "\n",
        text,
        count=1,
    )

    # --- remove modal + request dialogs + request detail animate block before create modal ---
    text = re.sub(
        r"\n      <AtlasModalFrame[\s\S]*?\n      <AnimatePresence>\n        \{createOpen \?",
        "\n      <AnimatePresence>\n        {createOpen ?",
        text,
        count=1,
    )

    TARGET.write_text(text, encoding="utf-8", newline="\n")
    sample = next(line for line in text.splitlines() if "Gesti" in line and "Tiendas" in line and "h1" in line)
    print("Written:", TARGET)
    print("Sample:", sample.strip())
    bad = sum(1 for line in text.splitlines() if "Ã" in line)
    print("Mojibake lines remaining:", bad)


if __name__ == "__main__":
    main()
