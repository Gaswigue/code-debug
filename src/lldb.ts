import { MI2DebugSession } from './mibase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { escape } from "./backend/mi_parse"
import { MI2_LLDB } from "./backend/mi2/mi2lldb";
import { SSHArguments } from './backend/backend';

export interface CommonRequestArguments {
	cwd: string;
	target: string;
	lldbmipath: string;
	debugger_args: string[];
	executable: string;
	arguments: string;
	autorun: string[];
	autorunBefore: string[];
	ssh: SSHArguments;
	printCalls: boolean;
	showDevDebugOutput: boolean;
}

export interface LaunchRequestArguments extends CommonRequestArguments { }
export interface AttachRequestArguments extends CommonRequestArguments { }

class LLDBDebugSession extends MI2DebugSession {
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsFunctionBreakpoints = true;
		response.body.supportsEvaluateForHovers = true;
		this.sendResponse(response);
	}

	private initiliaseDefaultValueArgs(args: CommonRequestArguments, attach: boolean) {
		this.quit = false;
		this.attached = false;
		this.needContinue = false;
		this.isSSH = false;
		this.started = false;
		this.crashed = false;
		this.debugReady = false;
		this.miDebugger.printCalls = !!args.printCalls;
		this.miDebugger.debugOutput = !!args.showDevDebugOutput;
		var hasAutorunBeforeArgs = args.autorunBefore !== undefined;


		if (args.ssh !== undefined) {
			if (args.ssh.forwardX11 === undefined)
				args.ssh.forwardX11 = true;
			if (args.ssh.port === undefined)
				args.ssh.port = 22;
			if (args.ssh.x11port === undefined)
				args.ssh.x11port = 6000;
			if (args.ssh.x11host === undefined)
				args.ssh.x11host = "localhost";
			if (args.ssh.remotex11screen === undefined)
				args.ssh.remotex11screen = 0;
			this.isSSH = true;
			this.trimCWD = args.cwd.replace(/\\/g, "/");
			this.switchCWD = args.ssh.cwd;
		}
		if (args.autorun === undefined)
			args.autorun = [];

		if (!hasAutorunBeforeArgs)
			args.autorunBefore = ["gdb-set target-async on",
				"environment-directory \"$cwd\""];

		if (attach) {
			this.attached = true;
			this.needContinue = true;
			if (!hasAutorunBeforeArgs)
				args.autorunBefore.push("target-select remote $target");

		}

		args.autorun = args.autorun.map(
			s => {return escape(s);
		});

		args.autorunBefore = args.autorunBefore.map(
			s => {
				return s.replace(/\$cwd/, escape(args.cwd))
					.replace(/\$target/, args.target);
			});
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.miDebugger = new MI2_LLDB(args.lldbmipath || "lldb-mi", [], args.debugger_args);
		this.initDebugger();
		this.initiliaseDefaultValueArgs(args, false);

		if (this.isSSH) {
			this.miDebugger.ssh(args.ssh, args.ssh.cwd, args.target, args.autorunBefore, args.arguments, undefined, false).then(() => {
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
				setTimeout(() => {
					this.miDebugger.emit("ui-break-done");
				}, 50);
				this.sendResponse(response);
				this.miDebugger.start().then(() => {
					this.started = true;
					if (this.crashed)
						this.handlePause(undefined);
				});
			});
		}
		else {
			this.miDebugger.load(args.cwd, args.target, args.autorunBefore, args.arguments, undefined).then(() => {
				args.autorun.forEach(command => {
					this.miDebugger.sendUserInput(command);
				});
				setTimeout(() => {
					this.miDebugger.emit("ui-break-done");
				}, 50);
				this.sendResponse(response);
				this.miDebugger.start().then(() => {
					this.started = true;
					if (this.crashed)
						this.handlePause(undefined);
				});
			});
		}
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
		this.miDebugger = new MI2_LLDB(args.lldbmipath || "lldb-mi", [], args.debugger_args);
		this.initDebugger();
		this.initiliaseDefaultValueArgs(args, true);

		this.miDebugger.attach(args.cwd, args.executable, args.target, args.autorunBefore).then(() => {
			args.autorun.forEach(command => {
				this.miDebugger.sendUserInput(command);
			});
			this.sendResponse(response);
		});
	}
}

DebugSession.run(LLDBDebugSession);