// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  bootstrap: true,
  session: null as unknown,
  listener: undefined as undefined | ((event: string, session: unknown) => void),
  signIn: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/components/GridManager", () => ({ default: () => <div>Workspace hazır</div> }));
vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: mocks.session } }),
      getUser: mocks.getUser,
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        mocks.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signInWithPassword: mocks.signIn,
      signOut: vi.fn(),
    },
  }),
}));

import AuthGate from "./AuthGate";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.listener = undefined;
  mocks.session = null;
  mocks.signIn.mockReset();
  mocks.getUser.mockReset();
});

function mockBootstrap(canBootstrap: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ canBootstrap }), { status: 200 })));
}

describe("AuthGate ilk hesap akışı", () => {
  it("kullanıcı yokken önce yalnız İlk Hesabı Oluştur eylemini gösterir", async () => {
    mockBootstrap(true);
    render(<AuthGate />);
    await screen.findByRole("button", { name: "İlk Hesabı Oluştur" });
    expect(screen.queryByLabelText("E-posta")).toBeNull();
    expect(screen.queryByLabelText("Şifre")).toBeNull();
  });

  it("ilk hesap formunda eşleşmeyen şifreyi Türkçe hata ile engeller", async () => {
    mockBootstrap(true);
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: "İlk Hesabı Oluştur" }));
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "ilk@dijivo.test" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Şifreyi tekrar gir"), { target: { value: "654321" } });
    fireEvent.submit(screen.getByRole("button", { name: "Hesabı Oluştur" }).closest("form")!);
    expect(await screen.findByText("Şifreler uyuşmuyor.")).toBeTruthy();
  });

  it("kullanıcı varsa normal giriş formunu gösterir", async () => {
    mockBootstrap(false);
    render(<AuthGate />);
    expect(await screen.findByLabelText("E-posta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Giriş yap" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "İlk Hesabı Oluştur" })).toBeNull();
  });

  it("başarılı bootstrap sonrası oturum açıldığında ilk ekranı kapatır", async () => {
    mockBootstrap(true);
    mocks.signIn.mockImplementation(async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { email: "ilk@dijivo.test" } }, error: null });
      mocks.listener?.("SIGNED_IN", { user: { email: "ilk@dijivo.test" } });
      return { error: null };
    });
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: "İlk Hesabı Oluştur" }));
    fireEvent.change(screen.getByLabelText("E-posta"), { target: { value: "ilk@dijivo.test" } });
    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Şifreyi tekrar gir"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("button", { name: "Hesabı Oluştur" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Workspace hazır")).toBeTruthy());
  });

  it("403 alan gizli sekmeyi bootstrap=true iken ilk hesap ekranında tutar", async () => {
    mocks.session = { user: { email: "stale@dijivo.test" } };
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 403, message: "Forbidden" } });
    mockBootstrap(true);
    render(<AuthGate />);
    expect(await screen.findByRole("button", { name: "İlk Hesabı Oluştur" })).toBeTruthy();
    expect(screen.queryByText("Workspace hazır")).toBeNull();
    expect(screen.queryByText(/Marka Oluştur/i)).toBeNull();
  });

  it("403/session yok ve bootstrap=false iken normal giriş formunu gösterir", async () => {
    mocks.session = { user: { email: "stale@dijivo.test" } };
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 403, message: "Forbidden" } });
    mockBootstrap(false);
    render(<AuthGate />);
    expect(await screen.findByRole("button", { name: "Giriş yap" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "İlk Hesabı Oluştur" })).toBeNull();
    expect(screen.queryByText("Workspace hazır")).toBeNull();
  });

  it("getUser doğrulamasından geçen kullanıcı için workspace'i açar", async () => {
    mocks.session = { user: { email: "cached@dijivo.test" } };
    mocks.getUser.mockResolvedValue({ data: { user: { email: "gecerli@dijivo.test" } }, error: null });
    render(<AuthGate />);
    expect(await screen.findByText("Workspace hazır")).toBeTruthy();
  });
});
