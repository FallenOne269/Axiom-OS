variable "aws_region" {
  description = "AWS region for the remote AXIOM cluster."
  type        = string
}

variable "cluster_name" {
  description = "Name of the EKS cluster."
  type        = string
  default     = "axiom-remote"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version approved for the organization."
  type        = string
  default     = "1.30"
}

variable "private_subnet_ids" {
  description = "At least two private subnet IDs in separate availability zones."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnet IDs are required for EKS."
  }
}

variable "node_instance_types" {
  description = "GPU-capable or CPU node types for AXIOM remote work."
  type        = list(string)
  default     = ["g5.xlarge"]
}

variable "node_desired_size" {
  description = "Desired managed-node count."
  type        = number
  default     = 1
}

variable "node_min_size" {
  description = "Minimum managed-node count."
  type        = number
  default     = 0
}

variable "node_max_size" {
  description = "Maximum managed-node count."
  type        = number
  default     = 5
}

variable "enable_public_endpoint" {
  description = "Whether the EKS API endpoint may be reachable from the public Internet."
  type        = bool
  default     = false
}

variable "public_endpoint_cidrs" {
  description = "Allowlisted CIDRs when the public EKS API endpoint is enabled."
  type        = list(string)
  default     = []
}
