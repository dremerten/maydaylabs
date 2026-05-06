#!/bin/bash
NAMESPACE="${NAMESPACE:-k8squest}"

echo "🔍 Checking pod status..."

POD_STATUS=$(kubectl get pod hungry-app -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null)
READY=$(kubectl get pod hungry-app -n "$NAMESPACE" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null)

echo "   Phase: $POD_STATUS"
echo "   Ready: $READY"

if [[ "$POD_STATUS" == "Running" ]] && [[ "$READY" == "true" ]]; then
    echo "✅ Pod successfully scheduled and running"
    exit 0
else
    echo "❌ Pod is not running properly"
    echo "💡 Hint: Check 'kubectl describe pod hungry-app -n "$NAMESPACE"' for scheduling issues"
    exit 1
fi
