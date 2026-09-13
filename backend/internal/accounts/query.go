package accounts

import (
	"net"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

type Query struct {
	AccountID *int64
	Domain    string
	Subdomain string
}

func NormalizeQuery(raw string) Query {
	q := strings.TrimSpace(raw)
	if q == "" {
		return Query{}
	}
	lower := strings.ToLower(q)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		if parsed, err := url.Parse(q); err == nil && parsed.Host != "" {
			host := parsed.Host
			if h, _, err := net.SplitHostPort(host); err == nil {
				host = h
			}
			q = host
		}
	}
	q = strings.TrimSpace(q)
	if q == "" {
		return Query{}
	}
	if isAllDigits(q) {
		id, err := strconv.ParseInt(q, 10, 64)
		if err == nil && id > 0 {
			return Query{AccountID: &id}
		}
		return Query{}
	}
	q = strings.ToLower(q)
	if strings.Contains(q, ".") {
		return Query{Domain: q}
	}
	return Query{Subdomain: q}
}

func (q Query) CoreQ() string {
	if q.AccountID != nil {
		return strconv.FormatInt(*q.AccountID, 10)
	}
	if q.Domain != "" {
		return q.Domain
	}
	return q.Subdomain
}

func isAllDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
