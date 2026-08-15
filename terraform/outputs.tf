output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.axiom.name
}

output "cluster_endpoint" {
  description = "Private or public EKS API endpoint based on the selected policy."
  value       = aws_eks_cluster.axiom.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64 EKS cluster CA data for controlled kubeconfig generation."
  value       = aws_eks_cluster.axiom.certificate_authority[0].data
  sensitive   = true
}

output "node_group_name" {
  description = "Managed node group selected for AXIOM workloads."
  value       = aws_eks_node_group.axiom.node_group_name
}
