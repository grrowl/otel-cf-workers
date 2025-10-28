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
			const result = Reflect.get(target, prop)
			if (typeof result === 'function') {
				// RpcProperty must not be bound - it needs to be called with the unwrapped target
				if (result.constructor.name === 'RpcProperty') {
					const unwrappedTarget = unwrap(target)
					return (...args: unknown[]) => (unwrappedTarget as any)[prop](...args)
				}
				const boundResult = result.bind(rpcTarget)
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
