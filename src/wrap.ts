const unwrapSymbol = Symbol('unwrap')

type Wrapped<T> = { [unwrapSymbol]: T } & T

export function isWrapped<T>(item: T): item is Wrapped<T> {
	return item && !!(item as Wrapped<T>)[unwrapSymbol]
}

export function isProxyable(item: any) {
	return (item !== null && typeof item === 'object') || typeof item === 'function'
}

export function wrap<T extends object>(item: T, handler: ProxyHandler<T>, autoPassthrough: boolean = true): T {
	if (isWrapped(item) || !isProxyable(item)) {
		return item
	}
	const proxyHandler = Object.assign({}, handler)
	proxyHandler.get = (target, prop, receiver) => {
		if (prop === unwrapSymbol) {
			return item
		} else {
			if (handler.get) {
				return handler.get(target, prop, receiver)
			} else if (prop === 'bind') {
				return () => receiver
			} else if (autoPassthrough) {
				return passthroughGet(target, prop)
			}
		}
	}
	proxyHandler.apply = (target, thisArg, argArray) => {
		if (handler.apply) {
			return handler.apply(unwrap(target), unwrap(thisArg), argArray)
		}
	}
	return new Proxy(item, proxyHandler)
}

export function unwrap<T extends object>(item: T): T {
	if (item && isWrapped(item)) {
		return item[unwrapSymbol]
	} else {
		return item
	}
}

export function passthroughGet(target: any, prop: string | symbol, thisArg?: any) {
	const unwrappedTarget = unwrap(target)
	thisArg = unwrap(thisArg) || unwrappedTarget
	const value = Reflect.get(unwrappedTarget, prop)

	// DEBUG LOGGING
	console.log('[otel-passthroughGet] Property:', String(prop))
	console.log('[otel-passthroughGet] Value type:', typeof value)
	if (typeof value === 'function') {
		console.log('[otel-passthroughGet] Function constructor name:', value.constructor.name)
		console.log('[otel-passthroughGet] Is RpcProperty?', value.constructor.name === 'RpcProperty')

		if (value.constructor.name === 'RpcProperty') {
			console.log('[otel-passthroughGet] ✅ Returning RpcProperty wrapper')
			return (...args: unknown[]) => unwrappedTarget[prop](...args)
		}
		console.log('[otel-passthroughGet] ⚠️  Binding function to thisArg')
		return value.bind(thisArg)
	} else {
		return value
	}
}
