import { useEffect, useRef, useState } from "preact/hooks";
import { JSX } from "preact";
import "./global.css";
import { invoke } from '@tauri-apps/api/core';
import { Store } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
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
}

type ConnectStatus = "disconnected" | "connecting" | "connected";


function App() {
  const [port, setPort] = useState(11434);
  const [addr, setAddr] = useState("localhost");
  const [apiAddr, setApiAddr] = useState("https://api.deepseek.com/v1");
  const [apikey, setApikey] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("disconnected");
  const trayRef = useRef<TrayIcon>(null);
  const menuRef = useRef<Menu>(null);
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
    })();
  }, []);

  useEffect(() => {
    listen<ConnectStatus>("connect_status", (event) => {
      setConnectStatus(event.payload);
    })
  }, []);

  const aboutRef = useRef<HTMLDialogElement>(null);

  return (
    <main className={"w-screen h-screen overflow-hidden flex flex-col items-start justify-start gap-2 px-3 pt-1 pb-3 font-semibold text-sm text-center bg-neutral-200/35"}>
      {/* <div className={"h-10 w-full border-b border-transparent shadow-2xl"} data-tauri-drag-region /> */}
      <div className="hero bg-base-200 h-20 bg-gradient-to-br from-10% to-95% from-sky-500/80 via-60% via-purple-400/50 to-lime-500/95 rounded-sm">
        <div className="hero-content text-center text-gray-100/80 select-none cursor-default rounded-sm overflow-hidden">
          <div className="w-full">
            <h1 className="text-5xl font-semibold font-mono font-stretch-expanded text-white text-shadow-lg text-shadow-black/50">
              DEEPROXY
            </h1>
          </div>
        </div>
      </div>
      <div className={"w-full grid grid-cols-1 gap-2 p-2 border border-neutral-300/75 rounded-sm"}>
        <div className={"w-full grid grid-cols-8 items-center p-1 gap-1"}>
          <span className="label col-span-2 select-none cursor-default">监听:</span>
          <input
            type="text"
            className="input input-xs col-span-3 focus-within:outline-0 p-1"
            value={addr}
            spellcheck={false}
            onInput={(e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
              const target = e.target as HTMLInputElement;
              if (target && target.value && isValidIpAddress(target.value)) {
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
      </div>
      <div className={"inline-flex w-full flex-1 flex-row-reverse items-center justify-start p-1 gap-2"}>
        <button
          className={"btn btn-xs btn-error select-none cursor-default text-white"}
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
          className={"btn btn-xs btn-success select-none cursor-default"}
          onClick={() => {
            (async () => {
              try {
                if (connectStatus === "disconnected") {
                  await invoke("start_server");
                } else {
                  await invoke("restart");
                }
              } catch (error) {
                console.error("Start/restart failed:", error);
                setConnectStatus("disconnected");
              }
            })();
          }}
          disabled={addr.length === 0 || port < 1 || port > 65535 || !isValidIpAddress(addr) || apiAddr.length === 0 || apikey.length === 0}
        >
          {`${connectStatus === "disconnected" ? "启动" : "重启"}`}
        </button>
        <button
          className={"btn btn-xs btn-primary select-none cursor-default"}
          onClick={() => {
            const config: Config = {
              addr: addr,
              port: port,
              api_addr: apiAddr,
              apikey: apikey,
              skills: skills
            };

            (async () => {
              const store = await Store.load("config.json");
              await store.set("config", config);
              await store.save();
            })();
          }}
          disabled={addr.length === 0 || port < 1 || port > 65535 || !isValidIpAddress(addr) || apiAddr.length === 0 || apikey.length === 0 || connectStatus !== "disconnected"}
        >
          {`保存`}
        </button>
        <button
          className={"btn btn-circle btn-xs"}
          onClick={() => {
            aboutRef.current?.showModal();
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-info" viewBox="0 0 16 16">
            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
          </svg>
        </button>
        <div className={"flex-1 flex h-full flex-row justify-start items-center  gap-2 text-xs select-none cursor-default"}>
          <div class="inline-grid *:[grid-area:1/1]">
            <div className={`status ${connectStatus === "disconnected" ? "status-secondary animate-none" : connectStatus === "connecting" ? "status-warning animate-ping" : "status-success animate-ping"}`}></div>
            <div className={`status ${connectStatus === "disconnected" ? "status-secondary" : connectStatus === "connecting" ? "status-warning" : "status-success"}`}></div>
          </div>
          {connectStatus === "disconnected" ? "未启动" : connectStatus === "connecting" ? "启动中" : "已启动"}
        </div>
        <dialog className={"modal"} ref={aboutRef}>
          <div className={"modal-box p-3 gap-2 overflow-hidden"}>
            <h3 className={"font-semibold text-lg"}>关于Deeproxy</h3>
            <p className={"font-mono text-sm cursor-pointer hover:underline hover:text-primary"} onClick={() => {
              aboutRef.current?.close();
              openUrl("https://github.com/lzm04521/deeproxy");
            }}>
              github.com/lzm04521/deeproxy
            </p>
            <div className={"modal-action"}>
              <form method={"dialog"}>
                <button>关闭</button>
              </form>
            </div>
          </div>

        </dialog>
      </div>
    </main>
  );
}

export default App;
