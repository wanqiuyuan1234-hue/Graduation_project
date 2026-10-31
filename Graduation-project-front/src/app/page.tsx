"use client";

import { useNavStore } from "@/lib/rag/store";
import { AppSidebar } from "@/components/rag/shared/app-sidebar";
import { AppHeader } from "@/components/rag/shared/app-header";
import { AppFooter } from "@/components/rag/shared/app-footer";
import { ModuleBrowserPage } from "@/components/rag/modules/module-browser";
import { ModuleDetailPage } from "@/components/rag/modules/module-detail";
import { ChatPage } from "@/components/rag/chat/chat-page";
import { KnowledgeBasePage } from "@/components/rag/knowledge/knowledge-base";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFocusTrap } from "@/hooks/use-focus-trap";

/**
 * Selector uniquely matching the source panel's root `motion.aside`
 * (source-panel.tsx renders `<motion.aside className="fixed top-0 right-0 z-50 …">`).
 * No other element in the shell combines `fixed` + `top-0` + `right-0` + `z-50`
 * + `aside`, so this is stable without editing source-panel.tsx to add a
 * data-attribute. Used by the focus trap so Tab cycles inside the panel while
 * it's open.
 */
const SOURCE_PANEL_SELECTOR = "aside.fixed.top-0.right-0.z-50";

export default function Home() {
  const view = useNavStore((s) => s.view);
  const sourcePanelOpen = useNavStore((s) => s.sourcePanelOpen);

  // Register global keyboard shortcuts (`/`, `g m/c/k`, `t`, `?`, `Esc`) once
  // for the whole app shell. The hook reads fresh store state inside its
  // handler so it never goes stale and never causes re-renders.
  useKeyboardShortcuts();

  // Trap focus inside the source panel while it's open. The hook is a no-op
  // when `sourcePanelOpen` is false or when the panel isn't mounted (e.g. on
  // non-chat views). On close, focus is restored to the element that opened
  // the panel — standard modal behavior for the slide-out.
  useFocusTrap(sourcePanelOpen, SOURCE_PANEL_SELECTOR);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-1.5 focus:text-sm focus:shadow-card"
      >
        跳到主内容
      </a>
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <main
          id="main-content"
          role="main"
          aria-label="主内容区"
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
        >
          <AppHeader />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {view === "modules" && <ModuleBrowserPage />}
            {view === "detail" && <ModuleDetailPage />}
            {view === "chat" && <ChatPage />}
            {view === "knowledge" && (
              <div className="min-h-full">
                <KnowledgeBasePage />
              </div>
            )}
          </div>
          <AppFooter />
        </main>
      </div>
    </div>
  );
}
