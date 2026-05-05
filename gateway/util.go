package main

import (
	"context"
	"time"
)

// contextWithTimeout returns a child of parent with the given timeout.
// Wraps context.WithTimeout for tests/mocks; kept trivial.
func contextWithTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, d)
}
