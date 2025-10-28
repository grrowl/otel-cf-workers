import { context as api_context } from '@opentelemetry/api'
import { unwrap, wrap } from '../wrap.js'
import { Initialiser, setConfig } from '../config.js'
import { RpcTarget } from 'cloudflare:workers'

type Env = Record<string, unknown>

function instrumentAnyFn(fn: (...args: any[]) => any, initialiser: Initialiser, env: Env) {
	const fnHandler: ProxyHandler<(...args: any[]) => any> = {
		async apply(target, thisArg, argArray) {
			thisArg = unwrap(thisArg)
			const config = initialiser(env, 'entrypoint-method')
			const context = setConfig(config)

			try {
				const bound = target.bind(thisArg)
				return await api_context.with(context, () => bound.apply(thisArg, argArray), undefined)
			} catch (error) {
				throw error
			}
		},
	}
	return wrap(fn, fnHandler)
}

function instrumentRpcTarget(rpcTarget: RpcTarget, initialiser: Initialiser) {
	const objHandler: ProxyHandler<RpcTarget> = {
		get(target, prop) {
			// Unwrap target first to access raw properties (especially important for RpcProperty)
			const unwrappedTarget = unwrap(target)
			const result = Reflect.get(unwrappedTarget, prop)

			// DEBUG LOGGING
			console.log('[otel-rpc] Accessing property:', String(prop))
			console.log('[otel-rpc] Result type:', typeof result)
			if (typeof result === 'function') {
				console.log('[otel-rpc] Function constructor name:', result.constructor.name)
				console.log('[otel-rpc] Is RpcProperty?', result.constructor.name === 'RpcProperty')

				// RpcProperty must not be bound - it needs to be called with the unwrapped target
				if (result.constructor.name === 'RpcProperty') {
					console.log('[otel-rpc] ✅ Returning RpcProperty wrapper using result.apply()')
					// Call the captured result directly with unwrapped target as `this`
					return (...args: unknown[]) => result.apply(unwrappedTarget, args)
				}
				console.log('[otel-rpc] ⚠️  Binding and instrumenting:', String(prop))
				const boundResult = result.bind(unwrappedTarget)
				return instrumentAnyFn(boundResult, initialiser, {})
			}
			return result
		},
	}
	return wrap(rpcTarget, objHandler)
}

export type RpcTargetClass = new (...args: any[]) => RpcTarget

export function instrumentRpcTargetClass<C extends RpcTargetClass>(entrypointClass: C, initialiser: Initialiser): C {
	const classHandler: ProxyHandler<C> = {
		construct(target, [...args]: ConstructorParameters<RpcTargetClass>) {
			return instrumentRpcTarget(new target(...args), initialiser)
		},
	}
	return wrap(entrypointClass, classHandler)
}
