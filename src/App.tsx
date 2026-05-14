import { useEffect, useRef, useState } from "preact/hooks";
import { JSX } from "preact";
import "./global.css";
import { invoke } from '@tauri-apps/api/core';
import { Store } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { createStartMenu, createStopMenu, createTray } from "./lib/menu";
import { isValidIpAddress } from "./lib/utils";


type Config = {
  addr: string;
  port: number;
  api_addr: string;
  apikey: string;
  skills: string[];
  selected_models: string[];
  autostart?: boolean;
}

type ConnectStatus = "disconnected" | "connecting" | "connected";

function App() {
  const [port, setPort] = useState(11434);
  const [addr, setAddr] = useState("localhost");
  const [apiAddr, setApiAddr] = useState("https://api.deepseek.com/v1");
  const [apikey, setApikey] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [showModelModal, setShowModelModal] = useState(false);
  const [tempSelectedModels, setTempSelectedModels] = useState<string[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("disconnected");
  const [isStarting, setIsStarting] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const trayRef = useRef<TrayIcon>(null);
  const menuRef = useRef<Menu>(null);
  const modelModalRef = useRef<HTMLDialogElement>(null);

  // Open/close modal
  useEffect(() => {
    if (showModelModal) {
      modelModalRef.current?.showModal();
    } else {
      modelModalRef.current?.close();
    }
  }, [showModelModal]);

  // Sync state when native dialog is closed (e.g. ESC key)
  useEffect(() => {
    const dialog = modelModalRef.current;
    if (!dialog) return;
    const onCancel = () => setShowModelModal(false);
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  useEffect(() => {
    if (trayRef && !trayRef.current) {
      (async () => {
        menuRef.current = await createStartMenu();

        trayRef.current = await createTray(menuRef.current);
        console.log("create tray icon")
      })();
    }
    return () => {
      if (trayRef && trayRef.current) {
        (async () => {
          await trayRef.current!.close();
          console.log("destroy tray icon")
          if (menuRef && menuRef.current) {
            menuRef.current.close();
            console.log("destroy menu")
          }
        })();
      }
    }
  }, []);
  useEffect(() => {
    let oldMenu: Menu | null = null;
    if (menuRef && menuRef.current) {
      oldMenu = menuRef.current;
    }
    if (trayRef && trayRef.current) {
      if (connectStatus === "disconnected") {
        (async () => {
          menuRef.current = await createStartMenu();
          if (trayRef && trayRef.current) {
            trayRef.current.setMenu(menuRef.current);
            if (oldMenu) {
              oldMenu.close();
            }
          }
        })();
      } else {
        (async () => {
          menuRef.current = await createStopMenu();
          if (trayRef && trayRef.current) {
            trayRef.current.setMenu(menuRef.current);
            if (oldMenu) {
              oldMenu.close();
            }
          }
        })();
      }
    }
  }, [connectStatus])

  useEffect(() => {
    (async () => {
      const store = await Store.load("config.json");
      const config = await store.get("config") as Config;
      setAddr(config.addr || "localhost");
      setPort(config.port || 11434);
      setApikey(config.apikey || "");
      setApiAddr(config.api_addr || "https://api.deepseek.com/v1");
      setSkills(config.skills || []);
      setSelectedModels(config.selected_models || []);
      
      // 加载开机自启状态
      try {
        const autoStartEnabled = await invoke<boolean>("is_autostart_enabled");
        setAutostart(autoStartEnabled);
      } catch (e) {
        console.error("Failed to get autostart status:", e);
      }
    })();
  }, []);

  useEffect(() => {
    listen<ConnectStatus>("connect_status", (event) => {
      setConnectStatus(event.payload);
    })
  }, []);

  // Debounce fetch models when apikey or apiAddr changes
  useEffect(() => {
    if (!apiAddr || !apikey) {
      setAvailableModels([]);
      return;
    }
    const handler = setTimeout(async () => {
      try {
        const models = await invoke<string[]>("fetch_models", { apiAddr: apiAddr, apikey: apikey });
        setAvailableModels(models);
      } catch (e) {
        console.error("Failed to fetch models:", e);
        setAvailableModels([]);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [apiAddr, apikey]);

  return (
    <main className={"w-full h-full flex flex-col items-start justify-start gap-2 px-3 pt-1 pb-3 font-semibold text-sm text-center bg-neutral-200/35"}>
      {/* <div className={"h-10 w-full border-b border-transparent shadow-2xl"} data-tauri-drag-region /> */}
      <div className="hero bg-base-200 h-16 bg-gradient-to-br from-10% to-95% from-sky-500/80 via-60% via-purple-400/50 to-lime-500/95 rounded-sm shrink-0">
        <div className="hero-content text-center text-gray-100/80 select-none cursor-default rounded-sm overflow-hidden py-1">
          <div className="w-full">
            <h1 className="text-3xl font-semibold font-mono font-stretch-expanded text-white text-shadow-lg text-shadow-black/50">
              DEEPROXY
            </h1>
          </div>
        </div>
      </div>


      <div className={"inline-flex w-full flex-1 flex-row-reverse items-center justify-start p-1 gap-4"}>
        <button
          className={"btn btn-sm btn-error select-none cursor-default text-white min-w-20"}
          onClick={() => {
            (async () => {
              invoke("stop");
            })();
          }}
          disabled={connectStatus === "disconnected"}
        >
          停止
        </button>
        <button
          className={"btn btn-sm btn-success select-none cursor-default min-w-20"}
          onClick={async () => {
            setIsStarting(true);
            try {
              if (connectStatus === "disconnected") {
                await invoke("start_server");
              } else {
                await invoke("restart");
              }
            } catch (error) {
              console.error("Start/restart failed:", error);
              setConnectStatus("disconnected");
            } finally {
              setIsStarting(false);
            }
          }}
          disabled={addr.length === 0 || port < 1 || port > 65535 || !isValidIpAddress(addr) || apiAddr.length === 0 || apikey.length === 0 || isStarting}
        >
          {isStarting ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            `${connectStatus === "disconnected" ? "启动" : "重启"}`
          )}
        </button>
        <button
          className={"btn btn-sm btn-primary select-none cursor-default min-w-20"}
          onClick={() => {
            const config: Config = {
              addr: addr,
              port: port,
              api_addr: apiAddr,
              apikey: apikey,
              skills: skills,
              selected_models: selectedModels,
              autostart: autostart
            };

            (async () => {
              const store = await Store.load("config.json");
              await store.set("config", config);
              await store.save();
              
              // 设置开机自启
              try {
                await invoke("set_autostart", { enabled: autostart });
              } catch (e) {
                console.error("Failed to set autostart:", e);
              }
              
              // 显示保存成功提示
              setShowSaveSuccess(true);
              setTimeout(() => {
                setShowSaveSuccess(false);
              }, 2000);
            })();
          }}
          disabled={addr.length === 0 || port < 1 || port > 65535 || !isValidIpAddress(addr) || apiAddr.length === 0 || apikey.length === 0 || connectStatus !== "disconnected"}
        >
          {`保存`}
        </button>
        
        {/* 保存成功提示 */}
        {showSaveSuccess && (
          <div className="fixed top-4 right-4 z-50 animate-bounce">
            <div className="alert alert-success shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>保存成功！</span>
            </div>
          </div>
        )}
      </div>
      <div className={"w-full min-h-[360px] flex flex-col gap-2 p-2 border border-neutral-300/75 rounded-sm overflow-y-auto min-h-0"}>
        <div className={"w-full grid grid-cols-8 items-center p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default">监听:</span>
          <input
            type="text"
            className="input input-xs col-span-3 focus-within:outline-0 p-1"
            value={addr}
            spellcheck={false}
            onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
              const target = e.target as HTMLInputElement;
              if (target) {
                setAddr(target.value)
              }
            }}
            disabled={connectStatus !== "disconnected"}
          />
          <span className="label col-span-1 select-none cursor-default">端口:</span>
          <input
            type="number"
            value={port}
            disabled={connectStatus !== "disconnected"}
            onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
              const target = e.target as HTMLInputElement;
              target && target.value && setPort(parseInt(target.value))
            }}
            className="input input-xs col-span-2 focus-within:outline-0"
          />
        </div>
        <div className={"w-full grid grid-cols-8 items-center p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default">ApiKey:</span>
          <input
            className="input input-xs col-span-6 focus-within:outline-0 p-1"
            spellcheck={false}
            value={apikey}
            type={"password"}
            disabled={connectStatus !== "disconnected"}
            onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
              const target = e.target as HTMLInputElement;

              requestAnimationFrame(() => {
                setApikey(target.value);
              });
            }}
          />
        </div>
        <div className={"w-full grid grid-cols-8 items-center p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default">API地址:</span>
          <input
            type="text"
            className="input input-xs col-span-6 focus-within:outline-0 p-1"
            spellcheck={false}
            value={apiAddr}
            disabled={connectStatus !== "disconnected"}
            onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
              const target = e.target as HTMLInputElement;
              setApiAddr(target.value)
            }}
          />
        </div>
        <div className={"w-full grid grid-cols-8 items-start p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default pt-1">模型:</span>
          <div className="col-span-6">
            <div
              className="input input-xs w-full min-h-[2rem] h-auto flex flex-wrap gap-1 p-1 cursor-pointer"
              onClick={() => {
                if (connectStatus === "disconnected") {
                  setTempSelectedModels([...selectedModels]);
                  setModelSearchQuery("");
                  setShowModelModal(true);
                }
              }}
            >
              {selectedModels.length === 0 ? (
                <span className="text-neutral-content/50 text-xs">选择模型...</span>
              ) : (
                selectedModels.map(m => (
                  <span key={m} className="badge badge-xs badge-primary gap-1">
                    {m}
                    {connectStatus === "disconnected" && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" onClick={(e) => {
                        e.stopPropagation();
                        setSelectedModels(prev => prev.filter(x => x !== m));
                      }}>
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
        <div className={"w-full grid grid-cols-8 items-center p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default">模型能力:</span>
          <div className={"col-span-6 flex flex-row gap-2 p-1 join "}>
            <label className={"label font-mono text-xs select-none cursor-default"}>
              <input
                type="checkbox"
                className={"checkbox-sm"}
                checked={skills.includes("tools")}
                disabled={connectStatus !== "disconnected"}
                onChange={() => {
                  setSkills(prev => {
                    if (prev.includes("tools")) {
                      return prev.filter(item => item !== "tools")
                    } else {
                      return [...prev, "tools"]
                    }
                  })
                }}
              />
              tools
            </label>
            <label className={"label font-mono text-xs"}>
              <input
                type="checkbox"
                className={"checkbox-sm select-none cursor-default"}
                checked={skills.includes("vision")}
                disabled={connectStatus !== "disconnected"}
                onChange={() => {
                  setSkills(prev => {
                    if (prev.includes("vision")) {
                      return prev.filter(item => item !== "vision")
                    } else {
                      return [...prev, "vision"]
                    }
                  })
                }}
              />
              vision
            </label>
            <label className={"label font-mono text-xs select-none cursor-default"}>
              <input
                type="checkbox"
                className={"checkbox-sm"}
                checked={skills.includes("thinking")}
                disabled={connectStatus !== "disconnected"}
                onChange={() => {
                  setSkills(prev => {
                    if (prev.includes("thinking")) {
                      return prev.filter(item => item !== "thinking")
                    } else {
                      return [...prev, "thinking"]
                    }
                  })
                }}
              />
              thinking
            </label>
          </div>
        </div>
        <div className={"w-full grid grid-cols-8 items-center p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default">开机自启:</span>
          <div className={"col-span-6 flex flex-row items-center p-1"}>
            <label className={"label font-mono text-xs select-none cursor-default flex items-center gap-2"}>
              <input
                type="checkbox"
                className={"toggle toggle-primary toggle-sm"}
                checked={autostart}
                onChange={async () => {
                  const newAutostart = !autostart;
                  setAutostart(newAutostart);
                  
                  // 立即保存开机自启设置
                  try {
                    await invoke("set_autostart", { enabled: newAutostart });
                    
                    // 只更新配置文件中的 autostart 字段
                    const store = await Store.load("config.json");
                    const config = await store.get("config") as Config;
                    if (config) {
                      config.autostart = newAutostart;
                      await store.set("config", config);
                      await store.save();
                    }
                  } catch (e) {
                    console.error("Failed to set autostart:", e);
                    // 如果失败，恢复原状态
                    setAutostart(!newAutostart);
                  }
                }}
              />
              <span>启用开机自启动</span>
            </label>
          </div>
        </div>
      </div>

      {/* 模型选择模态框 */}
      <dialog ref={modelModalRef} className="modal modal-middle">
        <div className="modal-box flex flex-col">
          <h3 className="font-bold text-base mb-2">选择模型</h3>

          {/* 搜索框 */}
          <input
            type="text"
            placeholder="搜索模型..."
            className="input input-bordered input-sm w-full mb-2"
            value={modelSearchQuery}
            onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
              const target = e.target as HTMLInputElement;
              setModelSearchQuery(target.value);
            }}
          />

          {/* 已选数量提示 */}
          {tempSelectedModels.length > 0 && (
            <div className="text-xs text-neutral-content/60 mb-1">
              已选 {tempSelectedModels.length} 个模型
            </div>
          )}

          {/* 模型列表 */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 min-h-0">
            {availableModels
              .filter(model =>
                model.toLowerCase().includes(modelSearchQuery.toLowerCase())
              )
              .map(model => (
                <label key={model} className="flex items-center gap-2 cursor-pointer px-2 py-1 hover:bg-base-200 rounded text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={tempSelectedModels.includes(model)}
                    onChange={() => {
                      setTempSelectedModels(prev =>
                        prev.includes(model)
                          ? prev.filter(m => m !== model)
                          : [...prev, model]
                      );
                    }}
                  />
                  <span className="text-xs truncate">{model}</span>
                </label>
              ))}
            {availableModels.length === 0 && (
              <p className="text-center text-neutral-content/50 py-4 text-xs">
                请先配置 API 地址和 ApiKey 以获取模型列表
              </p>
            )}
            {availableModels.length > 0 &&
              availableModels.filter(model =>
                model.toLowerCase().includes(modelSearchQuery.toLowerCase())
              ).length === 0 && (
                <p className="text-center text-neutral-content/50 py-4 text-xs">
                  未找到匹配的模型
                </p>
              )}
          </div>

          {/* 按钮组 */}
          <div className="modal-action mt-2 mb-0">
            <button
              className="btn btn-sm"
              onClick={() => {
                setShowModelModal(false);
              }}
            >
              取消
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                setSelectedModels([...tempSelectedModels]);
                setShowModelModal(false);
              }}
            >
              确定
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => setShowModelModal(false)}>close</button>
        </form>
      </dialog>
    </main>
  );
}

export default App;
